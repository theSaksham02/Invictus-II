FORMAT FOR THESE CONNECTIONS:
------------------------------------------------------------------------------
for example:
7 STM32 A10 to 15 ESP32-CAM1 U0T
this refers to the 7th pin of the STM32 pcm board which is labeled A10. this is connected to the 15h pin of the ESP32-CAM1 pcb board which is labeled U0T

4 STM32 B15 connects/intersects w (4 MPU-6500 SDA + 3 RFM69HCW1 MOSI)
same instructions above, except here is more than two pins being connected here using either the same or different wires, they're interconnected.

if there is no pcb board name explicitly mentioned, for example:
22 STM32 C13 to *EMPTY*
39 STM32 GND to *GROUND*
4 BMP388 SCK to *B6_STM*
EMPTY refers to no connections to the pin. GROUND is grounded.
------------------------------------------------------------------------------

WiFi LoRa 32(V3) [abbrev. LoRa] CONNECTIONS

1 LoRa GND to GROUND
2 LoRa 5V to 5V_BUS
3 LoRa Ve to EMPTY
4 LoRa Ve to EMPTY
5 LoRa RX to EMPTY
6 LoRa TX to EMPTY
7 LoRa RST to EMPTY
8 LoRa GPIO0 to EMPTY
9 LoRa GPIO36 to EMPTY
10 LoRa GPIO35 to EMPTY
11 LoRa GPIO34 to EMPTY
12 LoRa GPIO33 to EMPTY
13 LoRa GPIO47 to EMPTY
14 LoRa GPIO48 to EMPTY
15 LoRa GPIO26 to EMPTY
16 LoRa GPIO21 to EMPTY
17 LoRa GPIO20 to EMPTY
18 LoRa GPIO19 to EMPTY

19 LoRa GPIO7 to 3 Neo-6m1 TX
20 LoRa GPIO6 to 2 Neo-6m1 RX
21 LoRa GPIO5 to EMPTY
22 LoRa GPIO4 to EMPTY
23 LoRa GPIO3 to EMPTY
24 LoRa GPIO2 connnects/interesects w (3 BMP280 SCL + 4 LM75 4)
25 LoRa GPIO1 to 4 BMP280 SDA + 3 LM75 3)
26 LoRa GPIO38 to 6 SDCardModule1
27 LoRa GPIO39 to 5 SDCardModule1
28 LoRa GPIO40 to EMPTY
29 LoRa GPIO41 to 4 SDCardModule1
30 LoRa GPIO42 to 3 SdCardModule1
31 LoRa GPIO45 to EMPTY
32 LoRa GPIO46 to EMPTY
33 LoRa GPIO37 to EMPTY
34 LoRa 3V3 to EMPTY
35 LoRa 3V3 to 3V3_BUS
36 LoRa GND to GROUND

SDCardModule1 CONNECTIONS

1 SDCardModule1 to GROUND
2 SDCardModule1 to 5V_BUS3


Neo-6m1 CONNECTIONS

1 Neo-6m1 GND to GROUND
4 Neo-6m1 VCC to 5V_BUS

BMP280 CONNECTIONS

1 BMP280 VCC connects/interesects w (5 BMP280 CSB + 3V3_BUS)
2 BMP280 GND connects/interesects w (6 BMP280 SDO + GROUND)

LM75 CONNECTIONS

1 LM75 1 3V3_BUS
2 LM75 2 GROUND
5 LM75 5 to EMPTY

ESP32-CAM1 CONNECTIONS

1 ESP32-CAM1 IO4 to EMPTY
2 ESP32-CAM1 IO2to EMPTY
3 ESP32-CAM1 IO14 to EMPTY
4 ESP32-CAM1 IO15 to EMPTY
5 ESP32-CAM1 IO13 to EMPTY
6 ESP32-CAM1 IO12 to EMPTY
7 ESP32-CAM1 GND connects/interesects w (16 ESP32-CAM1 GND + 12 ESP32-CAM1 GND + GROUND)
8 ESP32-CAM1 5V to 5V_BUS
9 ESP32-CAM1 3V3 to EMPTY
10 ESP32-CAM1 IO16 to EMPTY
11 ESP32-CAM1 IO0 to EMPTY
13 ESP32-CAM1 VCC to EMPTY
14 ESP32-CAM1 U0R to EMPTY
15 ESP32-CAM1 U0T to EMPTY

LM2596 module CONNECTIONS

3 LM2596 OUT- connects with GROUND -> capacitor C5 1000 uF + 5V_BUS to 4 LM2596 OUT+
1 LM2596 IN- to 4 [Li-ion 2S 3A BMS] P- 
2 LM2596 IN+ to 2 [SwitchTBlock]
1 [SwitchTBlock] to 5 [Li-ion 2S 3A BMS] P+

Li-ion 2S 3A BMS CONNECTIONS
1 Li-ion 2S 3A BMS D- to 1 Battery JST B-
2 Li-ion 2S 3A BMS Dm to 2 Battery JST BM
3 Li-ion 2S 3A BMS D+ to 3 Battery JST B+
