import csv
import math
import os

output_path = os.path.join(os.path.dirname(__file__), 'machx_fake_flight.csv')

with open(output_path, 'w', newline='') as f:
    writer = csv.writer(f)
    writer.writerow([
        'pkt_id', 'timestamp_ms', 'altitude_m', 'temp_c', 'temp_c_1', 'temp_c_2', 'temp_c_3', 'temp_c_4',
        'pressure_hpa', 'accel_z', 'gyro_x', 'lat', 'lon', 'rssi_dbm', 'flags'
    ])
    
    t = 0.0
    pkt_id = 0
    alt = 0.0
    v = 0.0
    a = 150.0 # High initial acceleration
    
    state = 0
    flags = 0
    while t <= 400: # Max 400 seconds
        flags = 8 | 16 | 4 | 32 # bmp_ok, mpu_ok, gps_fix, sd_ok
        
        if state == 0:
            if t > 5:
                state = 1
                flags |= 1 # launched
        elif state == 1:
            flags |= 1 # launched
            if alt > 3000 or v < -10:
                state = 2
                flags |= 2 # apogee
            else:
                a = max(a - 15, -9.81) # thrust tapers off
                v += a * 0.1
                alt += v * 0.1
        elif state == 2:
            flags |= 1 | 2
            a = 0
            v = -20 # drogue
            if alt < 300:
                v = -5 # main
            alt += v * 0.1
            if alt <= 0:
                alt = 0
                state = 3
        elif state == 3:
            flags |= 1 | 2
            a = 0
            v = 0
            if t > 250:
                break
        
        pressure = 1013.25 * math.pow(max(1 - 2.25577e-5 * alt, 0), 5.25588)
        temp_c = 25.0 - (alt * 0.0065)
        
        t1 = temp_c + 2.1
        t2 = temp_c + 3.0
        t3 = temp_c - 1.5
        t4 = temp_c - 0.5
        
        writer.writerow([
            pkt_id, int(t * 1000), round(alt, 2), round(temp_c, 2), 
            round(t1, 2), round(t2, 2), round(t3, 2), round(t4, 2),
            round(pressure, 2), round(a/9.81, 2), 0,
            51.5, -0.1, max(-120, -50 - int(alt/100)), flags
        ])
        
        t += 0.1
        pkt_id += 1

print(f"Generated {pkt_id} packets into {output_path}")
