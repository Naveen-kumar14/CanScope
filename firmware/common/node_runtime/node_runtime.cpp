#include "node_runtime.h"

#if defined(ARDUINO) && defined(ESP_PLATFORM)

#include "driver/twai.h"
#include "esp_timer.h"

namespace canscope {

namespace {

const uint32_t kStatusPeriodMs = 1000;
const uint32_t kConfigHintPeriodMs = 10000;
const uint32_t kMaxFramesPerLoop = 16;

void serial_sink(const char* line, void*) { Serial.println(line); }

}  // namespace

NodeRuntime::NodeRuntime(const CanConfig& cfg, const BannerInfo& info)
    : cfg_(cfg), info_(info), can_ok_(false), last_status_ms_(0), last_retry_hint_ms_(0) {}

void NodeRuntime::setup() {
  const ConfigValidation validation = validate_config(cfg_);
  emit_banner(info_, cfg_, validation, serial_sink, nullptr);

  if (!validation.ok()) {
    emit_init_result(TransportResult::ConfigInvalid, 0, serial_sink, nullptr);
    return;
  }
  const TransportResult result = transport_.begin(cfg_);
  emit_init_result(result, transport_.last_driver_error(), serial_sink, nullptr);
  can_ok_ = result == TransportResult::Ok;
}

void NodeRuntime::loop() {
  const uint32_t now = millis();

  if (!can_ok_) {
    if (now - last_retry_hint_ms_ >= kConfigHintPeriodMs) {
      last_retry_hint_ms_ = now;
      Serial.println("# CAN not running: fix the node config (see banner) and reflash");
    }
    if (now - last_status_ms_ >= kStatusPeriodMs) {
      last_status_ms_ = now;
      print_status(empty_bus_status());
    }
    delay(10);
    return;
  }

  RawFrame frame;
  char line[256];
  for (uint32_t i = 0; i < kMaxFramesPerLoop; ++i) {
    if (transport_.receive(frame, i == 0 ? 10 : 0) != TransportResult::Ok) break;
    if (encode_frame_json(frame, line, sizeof(line))) Serial.println(line);
  }

  const BusStatus status = transport_.poll_status();
  if (transport_.last_alerts()) print_alerts(transport_.last_alerts());

  if (now - last_status_ms_ >= kStatusPeriodMs) {
    last_status_ms_ = now;
    print_status(status);
  }
}

void NodeRuntime::print_alerts(uint32_t alerts) {
  if (alerts & TWAI_ALERT_BUS_OFF) {
    Serial.println("# ALERT: BUS-OFF entered. Recovery is NOT automatic; check wiring/bit rate.");
  }
  if (alerts & TWAI_ALERT_BUS_RECOVERED) Serial.println("# ALERT: bus recovered (controller stopped)");
  if (alerts & TWAI_ALERT_ERR_PASS) Serial.println("# ALERT: error passive");
  if (alerts & TWAI_ALERT_ABOVE_ERR_WARN) Serial.println("# ALERT: error counter above warning limit");
  if (alerts & TWAI_ALERT_RX_QUEUE_FULL) Serial.println("# ALERT: RX queue full, frames dropped");
}

void NodeRuntime::print_status(const BusStatus& status) {
  char line[384];
  if (encode_status_json(cfg_.node_name, static_cast<uint64_t>(esp_timer_get_time()), cfg_, status,
                         line, sizeof(line))) {
    Serial.println(line);
  }
}

}  // namespace canscope

#endif
