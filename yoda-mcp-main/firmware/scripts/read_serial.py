import serial, time, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

dur = int(sys.argv[1]) if len(sys.argv) > 1 else 20
port = sys.argv[2] if len(sys.argv) > 2 else "COM5"

ser = None
for _ in range(40):  # retry open ~10s to survive USB re-enumeration after flash/reset
    try:
        ser = serial.Serial(port, 115200, timeout=0.2)
        break
    except Exception:
        time.sleep(0.25)
if ser is None:
    print("could not open", port)
    sys.exit(1)

ser.reset_input_buffer()
t0 = time.time()
while time.time() - t0 < dur:
    d = ser.read(4096)
    if d:
        sys.stdout.write(d.decode("utf-8", "replace"))
        sys.stdout.flush()
ser.close()
