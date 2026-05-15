import atexit
import os
import threading
import time

from flask import Flask, Response, jsonify, request
import cv2
import RPi.GPIO as GPIO

app = Flask(__name__)


def env_int(name, default):
    return int(os.environ.get(name, default))


def env_float(name, default):
    return float(os.environ.get(name, default))


PWM_FREQ_HZ = env_int("ROVER_PWM_FREQ_HZ", 1000)
COMMAND_TIMEOUT_S = env_float("ROVER_COMMAND_TIMEOUT_S", 0.5)
MAX_DUTY = env_int("ROVER_MAX_DUTY", 80)
SLEW_DUTY_PER_TICK = env_int("ROVER_SLEW_DUTY_PER_TICK", 20)
WATCHDOG_PERIOD_S = env_float("ROVER_WATCHDOG_PERIOD_S", 0.05)

# Existing repo pin defaults. For true BTS7960 bidirectional control, set
# LEFT_LPWM_PIN and RIGHT_LPWM_PIN to the wired reverse PWM inputs.
LEFT_RPWM_PIN = env_int("LEFT_RPWM_PIN", os.environ.get("L_PWM", 12))
LEFT_LPWM_PIN = os.environ.get("LEFT_LPWM_PIN")
LEFT_REN_PIN = env_int("LEFT_REN_PIN", os.environ.get("L_EN", 16))
LEFT_LEN_PIN = os.environ.get("LEFT_LEN_PIN")

RIGHT_RPWM_PIN = env_int("RIGHT_RPWM_PIN", os.environ.get("R_PWM", 13))
RIGHT_LPWM_PIN = os.environ.get("RIGHT_LPWM_PIN")
RIGHT_REN_PIN = env_int("RIGHT_REN_PIN", os.environ.get("R_EN", 26))
RIGHT_LEN_PIN = os.environ.get("RIGHT_LEN_PIN")

LEFT_LPWM_PIN = int(LEFT_LPWM_PIN) if LEFT_LPWM_PIN else None
LEFT_LEN_PIN = int(LEFT_LEN_PIN) if LEFT_LEN_PIN else LEFT_REN_PIN
RIGHT_LPWM_PIN = int(RIGHT_LPWM_PIN) if RIGHT_LPWM_PIN else None
RIGHT_LEN_PIN = int(RIGHT_LEN_PIN) if RIGHT_LEN_PIN else RIGHT_REN_PIN

state_lock = threading.Lock()
last_command_at = 0.0
target_left = 0
target_right = 0
current_left = 0
current_right = 0
estop_latched = False
watchdog_running = True

GPIO.setmode(GPIO.BCM)


class Motor:
    def __init__(self, name, rpwm_pin, lpwm_pin, ren_pin, len_pin):
        self.name = name
        self.rpwm_pin = rpwm_pin
        self.lpwm_pin = lpwm_pin
        self.ren_pin = ren_pin
        self.len_pin = len_pin
        pins = {rpwm_pin, ren_pin, len_pin}
        if lpwm_pin is not None:
            pins.add(lpwm_pin)
        GPIO.setup(list(pins), GPIO.OUT, initial=GPIO.LOW)
        self.rpwm = GPIO.PWM(rpwm_pin, PWM_FREQ_HZ)
        self.lpwm = GPIO.PWM(lpwm_pin, PWM_FREQ_HZ) if lpwm_pin is not None else None
        self.rpwm.start(0)
        if self.lpwm:
            self.lpwm.start(0)
        self.disable()

    @property
    def bidirectional(self):
        return self.lpwm is not None

    def enable(self):
        GPIO.output([self.ren_pin, self.len_pin], GPIO.HIGH)

    def disable(self):
        self.stop()
        GPIO.output([self.ren_pin, self.len_pin], GPIO.LOW)

    def stop(self):
        self.rpwm.ChangeDutyCycle(0)
        if self.lpwm:
            self.lpwm.ChangeDutyCycle(0)

    def set_speed(self, speed):
        speed = int(max(-MAX_DUTY, min(MAX_DUTY, speed)))
        duty = abs(speed)
        self.enable()
        if speed > 0:
            self.rpwm.ChangeDutyCycle(duty)
            if self.lpwm:
                self.lpwm.ChangeDutyCycle(0)
        elif speed < 0 and self.lpwm:
            self.rpwm.ChangeDutyCycle(0)
            self.lpwm.ChangeDutyCycle(duty)
        else:
            self.stop()


left_motor = Motor("left", LEFT_RPWM_PIN, LEFT_LPWM_PIN, LEFT_REN_PIN, LEFT_LEN_PIN)
right_motor = Motor("right", RIGHT_RPWM_PIN, RIGHT_LPWM_PIN, RIGHT_REN_PIN, RIGHT_LEN_PIN)


def clamp_command(value):
    numeric = float(value)
    if not -100 <= numeric <= 100:
        raise ValueError("motor command must be between -100 and 100")
    return int(numeric * MAX_DUTY / 100)


def stop_motors(disable=True):
    global target_left, target_right, current_left, current_right
    with state_lock:
        target_left = target_right = 0
        current_left = current_right = 0
    if disable:
        left_motor.disable()
        right_motor.disable()
    else:
        left_motor.stop()
        right_motor.stop()


def slew(current, target):
    if current < target:
        return min(current + SLEW_DUTY_PER_TICK, target)
    if current > target:
        return max(current - SLEW_DUTY_PER_TICK, target)
    return current


def watchdog_loop():
    global current_left, current_right
    while watchdog_running:
        now = time.monotonic()
        with state_lock:
            expired = last_command_at == 0 or (now - last_command_at) > COMMAND_TIMEOUT_S
            left_target = 0 if expired or estop_latched else target_left
            right_target = 0 if expired or estop_latched else target_right
            current_left = slew(current_left, left_target)
            current_right = slew(current_right, right_target)
            left = current_left
            right = current_right

        left_motor.set_speed(left)
        right_motor.set_speed(right)
        if expired or estop_latched:
            left_motor.disable()
            right_motor.disable()
        time.sleep(WATCHDOG_PERIOD_S)


watchdog_thread = threading.Thread(target=watchdog_loop, daemon=True)
watchdog_thread.start()


@app.route("/control", methods=["POST"])
@app.route("/api/rover/control", methods=["POST"])
def control():
    global last_command_at, target_left, target_right
    data = request.get_json(silent=True) or {}
    try:
        left = data.get("left", data.get("ly", 0))
        right = data.get("right", data.get("ry", 0))
        left = clamp_command(left)
        right = clamp_command(right)
    except (TypeError, ValueError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400

    with state_lock:
        if estop_latched:
            return jsonify({"ok": False, "error": "estop latched"}), 423
        target_left = left
        target_right = right
        last_command_at = time.monotonic()

    return jsonify({"ok": True, "left": left, "right": right})


@app.route("/stop", methods=["POST"])
@app.route("/api/rover/stop", methods=["POST"])
def stop():
    global estop_latched
    estop_latched = True
    stop_motors(disable=True)
    return jsonify({"ok": True, "stopped": True, "estop_latched": True})


@app.route("/arm", methods=["POST"])
@app.route("/api/rover/arm", methods=["POST"])
def arm():
    global estop_latched, last_command_at
    stop_motors(disable=True)
    with state_lock:
        estop_latched = False
        last_command_at = 0.0
    return jsonify({"ok": True, "armed": True})


@app.route("/data", methods=["GET"])
@app.route("/api/rover/data", methods=["GET"])
def data():
    with state_lock:
        age = None if last_command_at == 0 else time.monotonic() - last_command_at
        return jsonify({
            "ok": True,
            "left": current_left,
            "right": current_right,
            "target_left": target_left,
            "target_right": target_right,
            "command_age_s": age,
            "command_timeout_s": COMMAND_TIMEOUT_S,
            "estop_latched": estop_latched,
            "bidirectional": left_motor.bidirectional and right_motor.bidirectional
        })


def gen_frames():
    camera = cv2.VideoCapture(0)
    try:
        while True:
            success, frame = camera.read()
            if not success:
                break
            ret, buffer = cv2.imencode(".jpg", frame)
            if not ret:
                continue
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n"
            )
    finally:
        camera.release()


@app.route("/video_feed")
def video_feed():
    return Response(gen_frames(), mimetype="multipart/x-mixed-replace; boundary=frame")


def cleanup():
    global watchdog_running
    watchdog_running = False
    stop_motors(disable=True)
    GPIO.cleanup()


atexit.register(cleanup)


if __name__ == "__main__":
    try:
        app.run(host="0.0.0.0", port=5000, threaded=True)
    finally:
        cleanup()
