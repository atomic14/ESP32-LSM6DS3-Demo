#pragma once

#include <Arduino.h>

#define LED_PWM_FREQ_HZ 5000
#define LED_PWM_RES_BITS 8
#define LED_PWM_MAX_DUTY ((1 << LED_PWM_RES_BITS) - 1)
// Global brightness when an LED is considered "on" (0.0..1.0). Adjust to taste.
// 10% brightness
#define LED_BRIGHTNESS 0.10f


class StatusLeds {
public:
  enum LedState {
    LED_STATE_OFF,
    LED_STATE_ON,
    LED_STATE_BLINKING,
  };
private:
  enum LedcChannelIndices {
    LEDC_CHANNEL_RED = 0,
    LEDC_CHANNEL_GREEN = 1,
    LEDC_CHANNEL_BLUE = 2,
  };

  LedState redLedState = LED_STATE_OFF;
  LedState greenLedState = LED_STATE_OFF;
  LedState blueLedState = LED_STATE_OFF;

  int redPin;
  int greenPin;
  int bluePin;

  uint32_t blinkTimer = 0;
  bool blinkValue = false;

  void writeLedOnState(uint8_t channel, bool on) {
    const uint32_t dutyWhenOn =
        (uint32_t)(LED_PWM_MAX_DUTY * (1.0f - LED_BRIGHTNESS) + 0.5f);
    const uint32_t duty =
        on ? dutyWhenOn : LED_PWM_MAX_DUTY; // active-low: HIGH (max duty) = off
    ledcWrite(channel, duty);
  }

  void updateLed(LedState state, uint8_t channel) {
    switch (state) {
      case LED_STATE_OFF:
        writeLedOnState(channel, false);
        break;
      case LED_STATE_ON:
        writeLedOnState(channel, true);
        break;
      case LED_STATE_BLINKING:
        writeLedOnState(channel, blinkValue);
        break;
    }
  }
public:
  StatusLeds(int redPin, int greenPin, int bluePin) {
    this->redPin = redPin;
    this->greenPin = greenPin;
    this->bluePin = bluePin;
  }

  void begin() {
    ledcSetup(LEDC_CHANNEL_RED, LED_PWM_FREQ_HZ, LED_PWM_RES_BITS);
    ledcAttachPin(redPin, LEDC_CHANNEL_RED);
    ledcSetup(LEDC_CHANNEL_GREEN, LED_PWM_FREQ_HZ, LED_PWM_RES_BITS);
    ledcAttachPin(greenPin, LEDC_CHANNEL_GREEN);
    ledcSetup(LEDC_CHANNEL_BLUE, LED_PWM_FREQ_HZ, LED_PWM_RES_BITS);
    ledcAttachPin(bluePin, LEDC_CHANNEL_BLUE);  

    setRedLed(LED_STATE_OFF);
    setGreenLed(LED_STATE_OFF);
    setBlueLed(LED_STATE_OFF);  

    xTaskCreate(
      [](void *pvParameter) {
        StatusLeds *leds = static_cast<StatusLeds *>(pvParameter);
        leds->run();
      },
      "LEDS",
      1024, this, 1, nullptr);
  }

  void run() {
    while (true) {
      updateLed(redLedState, LEDC_CHANNEL_RED);
      updateLed(greenLedState, LEDC_CHANNEL_GREEN);
      updateLed(blueLedState, LEDC_CHANNEL_BLUE);
      blinkTimer += 100;
      if (blinkTimer >= 500) {
        blinkTimer = 0;
        blinkValue = !blinkValue;
      }
      vTaskDelay(100 / portTICK_PERIOD_MS);
    }
  }

  void setRedLed(LedState state) {
    redLedState = state;
  }
  void setGreenLed(LedState state) {
    greenLedState = state;
  }
  void setBlueLed(LedState state) {
    blueLedState = state;
  }
};