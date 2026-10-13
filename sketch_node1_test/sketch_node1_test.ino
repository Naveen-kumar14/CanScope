#include "driver/twai.h"

void setup()
{
  Serial.begin(115200);
  delay(1000);

  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(
    GPIO_NUM_17,
    GPIO_NUM_16,
    TWAI_MODE_NORMAL
  );

  twai_timing_config_t t_config = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  esp_err_t result = twai_driver_install(&g_config, &t_config, &f_config);

  if (result == ESP_OK)
  {
    Serial.println("TWAI driver installed successfully");
  }
  else
  {
    Serial.printf("Driver installation failed: %d\n", result);
    return;
  }

  result = twai_start();

  if (result == ESP_OK)
  {
    Serial.println("TWAI started successfully");
    Serial.println("Node 1 CAN controller ready");
  }
  else
  {
    Serial.printf("TWAI start failed: %d\n", result);
  }
}

void loop()
{
}
