"""
Simple MCP stdio <-> WebSocket pipe (vendored from github.com/78/mcp-calculator, v0.2.0).
Connects the local FastMCP server (stdio) to the xiaozhi.me MCP endpoint (WebSocket).

Usage:
    # PowerShell:  $env:MCP_ENDPOINT = "wss://api.xiaozhi.me/mcp/?token=..."   (or use .env)
    python mcp_pipe.py yoda_iccp.py
"""

import asyncio
import websockets
import subprocess
import logging
import os
import signal
import sys
import json
import time
from dotenv import load_dotenv

# Auto-load environment variables from a .env file if present
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('MCP_PIPE')

INITIAL_BACKOFF = 1
MAX_BACKOFF = 30          # cap reconnect delay so the demo recovers fast
HEALTHY_SECONDS = 20      # a session that lasted this long is healthy -> reset backoff


async def connect_with_retry(uri, target):
    # xiaozhi drops idle MCP connections every few minutes; treat a long-lived
    # session as healthy and reconnect fast, instead of doubling the delay forever.
    backoff = INITIAL_BACKOFF
    while True:
        started = time.monotonic()
        try:
            await connect_to_server(uri, target)
        except Exception as e:
            logger.warning(f"[{target}] Connection closed: {e}")
        if time.monotonic() - started >= HEALTHY_SECONDS:
            backoff = INITIAL_BACKOFF  # healthy session just idle-dropped
        logger.info(f"[{target}] Reconnecting in {backoff}s...")
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, MAX_BACKOFF)


async def connect_to_server(uri, target):
    try:
        logger.info(f"[{target}] Connecting to WebSocket endpoint...")
        async with websockets.connect(uri) as websocket:
            logger.info(f"[{target}] Successfully connected to the MCP endpoint")
            process = subprocess.Popen(
                [sys.executable, target],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                encoding='utf-8',
                text=True,
                env=os.environ.copy(),
            )
            logger.info(f"[{target}] Started MCP server process")
            await asyncio.gather(
                pipe_websocket_to_process(websocket, process, target),
                pipe_process_to_websocket(process, websocket, target),
                pipe_process_stderr_to_terminal(process, target),
            )
    except websockets.exceptions.ConnectionClosed as e:
        logger.error(f"[{target}] WebSocket connection closed: {e}")
        raise
    except Exception as e:
        logger.error(f"[{target}] Connection error: {e}")
        raise
    finally:
        if 'process' in locals():
            logger.info(f"[{target}] Terminating MCP server process")
            try:
                process.terminate()
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


async def pipe_websocket_to_process(websocket, process, target):
    try:
        while True:
            message = await websocket.recv()
            if isinstance(message, bytes):
                message = message.decode('utf-8')
            process.stdin.write(message + '\n')
            process.stdin.flush()
    except Exception as e:
        logger.error(f"[{target}] Error in WebSocket->process pipe: {e}")
        raise
    finally:
        if not process.stdin.closed:
            process.stdin.close()


async def pipe_process_to_websocket(process, websocket, target):
    try:
        while True:
            data = await asyncio.to_thread(process.stdout.readline)
            if not data:
                logger.info(f"[{target}] Process ended output")
                break
            await websocket.send(data)
    except Exception as e:
        logger.error(f"[{target}] Error in process->WebSocket pipe: {e}")
        raise


async def pipe_process_stderr_to_terminal(process, target):
    try:
        while True:
            data = await asyncio.to_thread(process.stderr.readline)
            if not data:
                break
            sys.stderr.write(data)
            sys.stderr.flush()
    except Exception as e:
        logger.error(f"[{target}] Error in stderr pipe: {e}")
        raise


def signal_handler(sig, frame):
    logger.info("Received interrupt signal, shutting down...")
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal_handler)
    endpoint_url = os.environ.get('MCP_ENDPOINT')
    if not endpoint_url:
        logger.error("Please set the `MCP_ENDPOINT` environment variable (or put it in .env)")
        sys.exit(1)
    if len(sys.argv) < 2 or not os.path.exists(sys.argv[1]):
        logger.error("Usage: python mcp_pipe.py <server_script.py>")
        sys.exit(1)
    target = sys.argv[1]
    try:
        asyncio.run(connect_with_retry(endpoint_url, target))
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
