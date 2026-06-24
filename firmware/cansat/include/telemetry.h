#pragma once
#include <stdint.h>

#define TELEMETRY_SYNC 0xA55A
#define TELEMETRY_VERSION_V2 2
#define TELEMETRY_VERSION 3
#define TELEMETRY_SOURCE_CANSAT 1
#define TELEMETRY_PAYLOAD_LEN_V2 36
#define TELEMETRY_PAYLOAD_LEN 53

#define CANSAT_MODE_PRE_DEPLOY 0
#define CANSAT_MODE_DEPLOYED_SCIENCE 1
#define CANSAT_MODE_GPS_RECOVERY 2

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
} TelemetryPacketV2;

typedef struct {
    uint16_t sync;           // bytes 0-1, 0xA55A
    uint8_t  version;        // byte 2, v3
    uint8_t  source_id;      // byte 3
    uint8_t  payload_len;    // byte 4
    uint16_t pkt_id;         // bytes 5-6
    uint32_t timestamp_ms;   // bytes 7-10
    uint8_t  mode;           // byte 11, CANSAT_MODE_*
    float    altitude_m;     // bytes 12-15
    float    temp_c;         // bytes 16-19, BMP388 temperature or last science value
    float    pressure_hpa;   // bytes 20-23
    float    temp_c_1;       // bytes 24-27, LM75-1 or -999 sentinel
    float    temp_c_2;       // bytes 28-31, LM75-2 or -999 sentinel
    float    temp_c_3;       // bytes 32-35, LM75-3 or -999 sentinel
    float    temp_c_4;       // bytes 36-39, LM75-4 or -999 sentinel
    float    accel_z;        // bytes 40-43
    float    gyro_x;         // bytes 44-47
    float    lat;            // bytes 48-51, only live in GPS recovery
    float    lon;            // bytes 52-55, only live in GPS recovery
    int8_t   rssi_dbm;       // byte 56, stamped by ground receiver
    uint8_t  flags;          // byte 57 (bit7=gps_recovery)
    uint16_t crc16;          // bytes 58-59, CCITT over bytes 0-57
} TelemetryPacket;
#pragma pack(pop)

// Compile-time guard: struct must match parser.js offsets
#ifdef __cplusplus
static_assert(sizeof(TelemetryPacketV2) == 43, "TelemetryPacketV2 size mismatch");
static_assert(sizeof(TelemetryPacket) == 60, "TelemetryPacket size mismatch");
#endif
