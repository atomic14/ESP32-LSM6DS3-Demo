//
// ESP32-S3 + LSM6DS3 firmware: stream accelerometer/gyro/temp as JSON over USB
// CDC
//

#include "Fusion.h"
#include <Arduino.h>
#include <LSM6DS3.h>
#include <Wire.h>

#include "BluetoothEmitter.h"
#include "SerialEmitter.h"
#include "IMUProcessor.h"
#include "StatusLeds.h"

// Hardware constants
#define I2C_SDA 7
#define I2C_SCL 15
// LSM6DS3 I2C address - choose between 0x6A and 0x6B - most boards use 0x6A
#define LSM6DS3_I2C_ADDR 0x6B

#define I2C_FREQUENCY_HZ 400000
#define SERIAL_BAUD 460800

// Battery status inputs
#define PIN_BATT_CHARGING 16 // input, active-low: LOW = charging
#define PIN_BATT_CHARGED 17  // input, active-low: LOW = charged

// Active-low LEDs
#define PIN_LED_RED 4   // output, active-low: LOW = on
#define PIN_LED_GREEN 6 // output, active-low: LOW = on
#define PIN_LED_BLUE 5  // output, active-low: LOW = on

// Sensor instance (I2C)
LSM6DS3 imu(I2C_MODE, LSM6DS3_I2C_ADDR);

static SerialEmitter *serialEmitter = nullptr;
static BluetoothEmitter *bluetoothEmitter = nullptr;
static IMUProcessor *imuProcessor = nullptr;
static StatusLeds *leds = nullptr;

void setup() {
  // USB serial
  Serial.begin(SERIAL_BAUD);

  // I2C on specified pins
  Wire.begin(I2C_SDA, I2C_SCL, I2C_FREQUENCY_HZ);

  // Initialize sensor

  if (imu.begin() != 0) {
    // Halt on failure
    while (true) {
      Serial.println("{ \"error\": \"Failed to initialize LSM6DS3\" }");
      delay(1000);
    }
  }

// GPIO configuration: battery status inputs and LEDs (active-low)
#ifdef PIN_BATT_CHARGING
  pinMode(PIN_BATT_CHARGING, INPUT_PULLUP);
  pinMode(PIN_BATT_CHARGED, INPUT_PULLUP);
#endif

  #ifdef PIN_LED_RED
  leds = new StatusLeds(PIN_LED_RED, PIN_LED_GREEN, PIN_LED_BLUE);
  leds->begin();
  #endif

  imuProcessor = new IMUProcessor(&imu);
  serialEmitter = new SerialEmitter(imuProcessor);
  bluetoothEmitter = new BluetoothEmitter(imuProcessor);

  serialEmitter->begin();
  bluetoothEmitter->begin();
}

void loop() {
  // Battery LED logic
  #ifdef PIN_BATT_CHARGED
  const bool isCharging = (digitalRead(PIN_BATT_CHARGING) == LOW);
  const bool isCharged = (digitalRead(PIN_BATT_CHARGED) == LOW);

  // RED: solid during charging (and not yet charged), off otherwise
  if (leds) leds->setRedLed(isCharging && !isCharged ? StatusLeds::LED_STATE_BLINKING : StatusLeds::LED_STATE_OFF);

  // GREEN: solid when charged, off otherwise
  if (leds) leds->setGreenLed(isCharged ? StatusLeds::LED_STATE_ON : StatusLeds::LED_STATE_OFF);
  #endif
  // Read in the values from the sensor
  // First, handle any incoming Serial commands (non-blocking)
  imuProcessor->update();

  serialEmitter->update();
  bluetoothEmitter->update();

  // Update BLE combined characteristic and notify if connected
  if (bluetoothEmitter->isConnected()) {
    // no need to blink the blue LED when connected
    if (leds) leds->setBlueLed(StatusLeds::LED_STATE_ON);
    // disable serial emitter when connected to BLE
    serialEmitter->setActive(false);
  } else {
    if (leds) leds->setBlueLed(StatusLeds::LED_STATE_BLINKING);
    // re-enable serial emitter when not connected to BLE
    serialEmitter->setActive(true);
  }
}