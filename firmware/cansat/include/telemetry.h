#pragma once
#include <stdint.h>

#pragma pack(push, 1)
typedef struct {
    uint16_t pkt_id;         // bytes 0-1
    uint32_t timestamp_ms;   // bytes 2-5
    float    altitude_m;     // bytes 6-9
    float    temp_c;         // bytes 10-13
    float    pressure_hpa;   // bytes 14-17
    float    accel_z;        // bytes 18-21
    float    gyro_x;         // bytes 22-25
    float    lat;            // bytes 26-29
    float    lon;            // bytes 30-33
    int8_t   rssi_dbm;       // byte 34
    uint8_t  flags;          // byte 35 (bit0=launched, bit1=apogee, bit2=gps_fix, bit3=bmp_ok, bit4=mpu_ok, bit5=sd_ok)
    uint8_t  checksum;       // byte 36
} TelemetryPacket;
#pragma pack(pop)

// Compile-time guard: struct must be exactly 37 bytes to match parser.js offsets
#ifdef __cplusplus
static_assert(sizeof(TelemetryPacket) == 37, "TelemetryPacket size mismatch — check struct padding");
#endif