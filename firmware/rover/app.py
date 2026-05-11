import time
from flask import Flask, request, jsonify, Response
import RPi.GPIO as GPIO
import cv2

app = Flask(__name__)

# PIN MAPPINGS (BTS7960 Motor Driver)
# LEFT MOTOR
L_PWM = 12
L_EN = 16
# RIGHT MOTOR
R_PWM = 13
R_EN = 26

GPIO.setmode(GPIO.BCM)
GPIO.setup([L_PWM, L_EN, R_PWM, R_EN], GPIO.OUT)

left_pwm = GPIO.PWM(L_PWM, 1000)
right_pwm = GPIO.PWM(R_PWM, 1000)
left_pwm.start(0)
right_pwm.start(0)

GPIO.output([L_EN, R_EN], GPIO.HIGH) # Enable drivers

@app.route('/api/rover/control', methods=['POST'])
def control():
    data = request.json
    # data format: {"lx": float, "ly": float, "rx": float, "ry": float} (sticks -1 to 1)
    ly = data.get('ly', 0)
    ry = data.get('ry', 0)
    
    # Differential Drive Logic
    l_speed = int(abs(ly) * 100)
    r_speed = int(abs(ry) * 100)
    
    # Simple forward/backward for now
    left_pwm.ChangeDutyCycle(l_speed)
    right_pwm.ChangeDutyCycle(r_speed)
    
    return jsonify({"status": "ok", "l": l_speed, "r": r_speed})

def gen_frames():
    camera = cv2.VideoCapture(0)
    while True:
        success, frame = camera.read()
        if not success:
            break
        else:
            ret, buffer = cv2.imencode('.jpg', frame)
            frame = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')

@app.route('/video_feed')
def video_feed():
    return Response(gen_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

if __name__ == '__main__':
    try:
        app.run(host='0.0.0.0', port=5000)
    except KeyboardInterrupt:
        GPIO.cleanup()
