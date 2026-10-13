# Host-side unit tests for the portable CANScope firmware libraries.
# They run on the PC (g++/clang/MSVC) and do NOT exercise the ESP32 or any CAN
# hardware. See docs/testing.md.
#
#   cmake -S test -B build/host-tests -G Ninja
#   cmake --build build/host-tests
#   ctest --test-dir build/host-tests --output-on-failure
cmake_minimum_required(VERSION 3.16)
project(canscope_host_tests CXX)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(FW_COMMON ${CMAKE_CURRENT_SOURCE_DIR}/../firmware/common)

add_library(canscope_portable STATIC
  ${FW_COMMON}/can_config/can_config.cpp
  ${FW_COMMON}/frame_capture/raw_frame.cpp
  ${FW_COMMON}/frame_capture/json_writer.cpp
  ${FW_COMMON}/can_transport/can_transport.cpp
  ${FW_COMMON}/protocol_decoder/protocol_registry.cpp
  ${FW_COMMON}/diagnostics/diagnostics.cpp
)
target_include_directories(canscope_portable PUBLIC
  ${FW_COMMON}/can_config
  ${FW_COMMON}/frame_capture
  ${FW_COMMON}/can_transport
  ${FW_COMMON}/protocol_decoder
  ${FW_COMMON}/diagnostics
)
if(NOT MSVC)
  target_compile_options(canscope_portable PRIVATE -Wall -Wextra -Werror)
endif()

enable_testing()

function(canscope_test name source)
  add_executable(${name} ${source})
  target_include_directories(${name} PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
  target_link_libraries(${name} PRIVATE canscope_portable)
  if(NOT MSVC)
    target_compile_options(${name} PRIVATE -Wall -Wextra -Werror)
  endif()
  add_test(NAME ${name} COMMAND ${name})
endfunction()

canscope_test(test_can_config firmware_host/test_can_config.cpp)
canscope_test(test_raw_frame firmware_host/test_raw_frame.cpp)
canscope_test(test_can_transport firmware_host/test_can_transport.cpp)
canscope_test(test_diagnostics firmware_host/test_diagnostics.cpp)
canscope_test(test_protocol_decoder protocol/test_protocol_decoder.cpp)
