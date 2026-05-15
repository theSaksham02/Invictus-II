#pragma once
#include <stdint.h>

#define TELEMETRY_SYNC 0xA55A
#define TELEMETRY_VERSION 2
#define TELEMETRY_SOURCE_CANSAT 1
#define TELEMETRY_PAYLOAD_LEN 36

#pragma pack(push, 1)
typedef struct {
    uint16_t sync;           // bytes 0-1, 0xA55A
    uint8_t  version;        // byte 2
    uint8_t  source_id;      // byte 3
    uint8_t  payload_len;    // byte 4
    uint16_t pkt_id;         // bytes 5-6
    uint32_t timestamp_ms;   // bytes 7-10
    float    altitude_m;     // bytes 11-14
    float    temp_c;         // bytes 15-18
    float    pressure_hpa;   // bytes 19-22
    float    accel_z;        // bytes 23-26
    float    gyro_x;         // bytes 27-30
    float    lat;            // bytes 31-34
    float    lon;            // bytes 35-38
    int8_t   rssi_dbm;       // byte 39
    uint8_t  flags;          // byte 40 (bit0=launched, bit1=apogee, bit2=gps_fix, bit3=bmp_ok, bit4=mpu_ok, bit5=sd_ok, bit6=stale_sensor)
    uint16_t crc16;          // bytes 41-42, CCITT over bytes 0-40
} TelemetryPacket;
#pragma pack(pop)

// Compile-time guard: struct must match parser.js offsets
#ifdef __cplusplus
static_assert(sizeof(TelemetryPacket) == 43, "TelemetryPacket size mismatch");
#endif
