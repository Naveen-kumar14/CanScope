
#include "driver/twai.h"

#define CAN_TX GPIO_NUM_17
#define CAN_RX GPIO_NUM_16

unsigned long lastBatteryUpdate = 0;
unsigned long lastHeartbeat = 0;

bool sendFrame(uint32_t id, uint8_t *data, uint8_t length)
{
  twai_message_t message = {};
  message.identifier = id;
  message.data_length_code = length;

  for (int i = 0; i < length; i++)
  {
    message.data[i] = data[i];
  }

  esp_err_t result = twai_transmit(&message, pdMS_TO_TICKS(100));

  if (result == ESP_OK)
  {
    Serial.printf("Sent CAN ID: 0x%03X\n", id);
    return true;
  }

  Serial.printf("Transmit failed for ID 0x%03X, error: %d\n", id, result);
  return false;
}

void setup()
{
  Serial.begin(115200);
  delay(1000);

  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(
    CAN_TX,
    CAN_RX,
    TWAI_MODE_NORMAL
  );

  twai_timing_config_t t_config = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  esp_err_t result = twai_driver_install(&g_config, &t_config, &f_config);

  if (result != ESP_OK)
  {
    Serial.printf("Driver installation failed: %d\n", result);
    return;
  }

  result = twai_start();

  if (result != ESP_OK)
  {
    Serial.printf("TWAI start failed: %d\n", result);
    twai_driver_uninstall();
    return;
  }

  Serial.println("Battery ECU Node 2 ready");
}

void loop()
{
  unsigned long now = millis();

  if (now - lastBatteryUpdate >= 1000)
  {
    lastBatteryUpdate = now;

    uint16_t voltage = 480;
    int16_t current = 120;
    uint8_t soc = 85;

    uint8_t voltageData[2] = {
      (uint8_t)(voltage >> 8),
      (uint8_t)(voltage & 0xFF)
    };

    uint8_t currentData[2] = {
      (uint8_t)(current >> 8),
      (uint8_t)(current & 0xFF)
    };

    uint8_t socData[1] = {soc};

    sendFrame(0x201, voltageData, 2);
    sendFrame(0x202, currentData, 2);
    sendFrame(0x203, socData, 1);
  }

  if (now - lastHeartbeat >= 500)
  {
    lastHeartbeat = now;

    uint8_t heartbeatData[1] = {1};
    sendFrame(0x210, heartbeatData, 1);
  }
}
