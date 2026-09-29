import serial, time, sys, threading, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ser = serial.Serial("COM5", 115200, timeout=0.2)
time.sleep(0.3)
ser.reset_input_buffer()

stop = threading.Event()
def reader():
    while not stop.is_set():
        d = ser.read(4096)
        if d:
            sys.stdout.write(d.decode("utf-8", "replace"))
            sys.stdout.flush()
th = threading.Thread(target=reader)
th.start()

time.sleep(1.5)
print("\n>>> CALL /ping", flush=True)
try:
    r = urllib.request.urlopen("http://10.250.104.193/ping", timeout=6).read().decode()
    print(">>> /ping resp:", r, flush=True)
except Exception as e:
    print(">>> /ping ERR:", e, flush=True)

time.sleep(7)
stop.set()
th.join()
ser.close()
print(">>> done", flush=True)
