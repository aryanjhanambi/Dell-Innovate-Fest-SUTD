#include "wifi_board.h"
#include "codecs/no_audio_codec.h"
#include "system_reset.h"
#include "application.h"
#include "button.h"
#include "config.h"
#include "mcp_server.h"
#include "esp32_camera.h"

#include <esp_log.h>
#include <esp_http_server.h>
#include <esp_netif.h>
#include <esp_wifi.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <string>
#include <string_view>

#define TAG "JarvisPendant"

// Pre-rendered announce clips (Opus/OGG), embedded from assets/common/*.ogg.
extern const char door_ogg_start[] asm("_binary_door_ogg_start");
extern const char door_ogg_end[]   asm("_binary_door_ogg_end");
extern const char checking_ogg_start[] asm("_binary_checking_ogg_start");
extern const char checking_ogg_end[]   asm("_binary_checking_ogg_end");

// Shared with the HTTP handlers (the board is a singleton).
static Esp32Camera* s_camera = nullptr;
static volatile bool s_camera_armed = false;

// Yoda welfare-check necklace: XIAO ESP32-S3 Sense + MAX98357A speaker + onboard
// PDM mic + OV2640 camera. Runs the xiaozhi voice stack AND a tiny LAN HTTP server
// so the caregiver dashboard can ping the senior and pull a camera photo on demand.
class YodaPendant : public WifiBoard {
private:
    Button boot_button_;
    Esp32Camera* camera_;
    httpd_handle_t server_ = nullptr;

    void InitializeCamera() {
        camera_config_t config = {};
        config.pin_d0 = CAMERA_PIN_D0;
        config.pin_d1 = CAMERA_PIN_D1;
        config.pin_d2 = CAMERA_PIN_D2;
        config.pin_d3 = CAMERA_PIN_D3;
        config.pin_d4 = CAMERA_PIN_D4;
        config.pin_d5 = CAMERA_PIN_D5;
        config.pin_d6 = CAMERA_PIN_D6;
        config.pin_d7 = CAMERA_PIN_D7;
        config.pin_xclk = CAMERA_PIN_XCLK;
        config.pin_pclk = CAMERA_PIN_PCLK;
        config.pin_vsync = CAMERA_PIN_VSYNC;
        config.pin_href = CAMERA_PIN_HREF;
        config.pin_sccb_sda = CAMERA_PIN_SIOD;
        config.pin_sccb_scl = CAMERA_PIN_SIOC;
        config.sccb_i2c_port = 1;  // keep camera SCCB off I2C0
        config.pin_pwdn = CAMERA_PIN_PWDN;
        config.pin_reset = CAMERA_PIN_RESET;
        config.xclk_freq_hz = XCLK_FREQ_HZ;
        config.pixel_format = PIXFORMAT_RGB565;
        config.frame_size = FRAMESIZE_VGA;
        config.jpeg_quality = 12;
        config.fb_count = 2;  // double-buffer: grab next frame while encoding -> smoother stream
        config.fb_location = CAMERA_FB_IN_PSRAM;
        config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
        camera_ = new Esp32Camera(config);
        camera_->SetHMirror(false);
        camera_->SetVFlip(false);
        s_camera = camera_;
    }

    void InitializeButtons() {
        boot_button_.OnClick([this]() {
            auto& app = Application::GetInstance();
            if (app.GetDeviceState() == kDeviceStateStarting) {
                EnterWifiConfigMode();
                return;
            }
            app.ToggleChatState();
        });
    }

    // ---- Welfare-check HTTP server (reached directly by the caregiver dashboard over the LAN) ----

    static void AddCors(httpd_req_t* req) {
        httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    }

    // GET /ping  -> beep + "someone is at the door" announce
    static esp_err_t PingHandler(httpd_req_t* req) {
        AddCors(req);
        std::string_view checkin(checking_ogg_start, (size_t)(checking_ogg_end - checking_ogg_start));
        Application::GetInstance().PlaySound(checkin);
        ESP_LOGI(TAG, "/ping -> played check-in announce");
        httpd_resp_set_type(req, "application/json");
        httpd_resp_sendstr(req, "{\"ok\":true,\"action\":\"ping\"}");
        return ESP_OK;
    }

    // GET /camera/on -> privacy announce, then arm the camera
    static esp_err_t CameraOnHandler(httpd_req_t* req) {
        AddCors(req);
        std::string_view checking(checking_ogg_start, (size_t)(checking_ogg_end - checking_ogg_start));
        Application::GetInstance().PlaySound(checking);
        s_camera_armed = true;
        ESP_LOGI(TAG, "/camera/on -> announced + armed");
        httpd_resp_set_type(req, "application/json");
        httpd_resp_sendstr(req, "{\"ok\":true,\"action\":\"camera_on\"}");
        return ESP_OK;
    }

    // GET /camera/off -> disarm
    static esp_err_t CameraOffHandler(httpd_req_t* req) {
        AddCors(req);
        s_camera_armed = false;
        ESP_LOGI(TAG, "/camera/off -> disarmed");
        httpd_resp_set_type(req, "application/json");
        httpd_resp_sendstr(req, "{\"ok\":true,\"action\":\"camera_off\"}");
        return ESP_OK;
    }

    // GET /capture -> one JPEG frame (only once armed, i.e. after the announce)
    static esp_err_t CaptureHandler(httpd_req_t* req) {
        AddCors(req);
        if (!s_camera_armed || s_camera == nullptr) {
            httpd_resp_set_status(req, "409 Conflict");
            httpd_resp_sendstr(req, "camera not armed - call /camera/on first");
            return ESP_OK;
        }
        std::string jpeg;
        if (!s_camera->CaptureToJpeg(jpeg) || jpeg.empty()) {
            httpd_resp_set_status(req, "500 Internal Server Error");
            httpd_resp_sendstr(req, "capture failed");
            return ESP_OK;
        }
        httpd_resp_set_type(req, "image/jpeg");
        httpd_resp_set_hdr(req, "Cache-Control", "no-store");
        httpd_resp_send(req, jpeg.data(), jpeg.size());
        return ESP_OK;
    }

    // GET /stream -> live MJPEG (multipart/x-mixed-replace) until the client disconnects.
    // Used by the dashboard for smooth video; /capture remains as a single-frame fallback.
    static esp_err_t StreamHandler(httpd_req_t* req) {
        AddCors(req);
        if (!s_camera_armed || s_camera == nullptr) {
            httpd_resp_set_status(req, "409 Conflict");
            httpd_resp_sendstr(req, "camera not armed - call /camera/on first");
            return ESP_OK;
        }
        httpd_resp_set_type(req, "multipart/x-mixed-replace; boundary=yodaframe");
        httpd_resp_set_hdr(req, "Cache-Control", "no-store");
        esp_wifi_set_ps(WIFI_PS_NONE);  // drop WiFi power-save latency so the stream is smooth
        ESP_LOGI(TAG, "/stream -> client connected, streaming");

        std::string jpeg;
        char part_hdr[96];
        while (s_camera_armed) {
            if (!s_camera->CaptureJpegStream(jpeg) || jpeg.empty()) {
                vTaskDelay(pdMS_TO_TICKS(50));
                continue;
            }
            int n = snprintf(part_hdr, sizeof(part_hdr),
                "\r\n--yodaframe\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
                (unsigned)jpeg.size());
            std::string part;
            part.reserve((size_t)n + jpeg.size());
            part.append(part_hdr, n);
            part.append(jpeg);
            if (httpd_resp_send_chunk(req, part.data(), part.size()) != ESP_OK) break;  // one write = fewer round-trips
            vTaskDelay(pdMS_TO_TICKS(10));  // small yield to the audio / wake-word tasks
        }
        esp_wifi_set_ps(WIFI_PS_MIN_MODEM);      // restore power-save when the stream ends
        httpd_resp_send_chunk(req, nullptr, 0);  // terminate the chunked response
        ESP_LOGI(TAG, "/stream -> client disconnected, stopped");
        return ESP_OK;
    }

    void StartWebServer() {
        if (server_ != nullptr) return;
        httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
        cfg.server_port = 80;
        cfg.ctrl_port = 32768;
        cfg.lru_purge_enable = true;
        cfg.stack_size = 10240;          // JPEG encode runs in the handler
        cfg.max_uri_handlers = 8;
        if (httpd_start(&server_, &cfg) != ESP_OK) {
            ESP_LOGE(TAG, "Failed to start welfare web server");
            return;
        }
        httpd_uri_t ping = {};      ping.uri = "/ping";       ping.method = HTTP_GET; ping.handler = PingHandler;
        httpd_uri_t cam_on = {};    cam_on.uri = "/camera/on"; cam_on.method = HTTP_GET; cam_on.handler = CameraOnHandler;
        httpd_uri_t cam_off = {};   cam_off.uri = "/camera/off"; cam_off.method = HTTP_GET; cam_off.handler = CameraOffHandler;
        httpd_uri_t cap = {};       cap.uri = "/capture";     cap.method = HTTP_GET; cap.handler = CaptureHandler;
        httpd_uri_t strm = {};      strm.uri = "/stream";     strm.method = HTTP_GET; strm.handler = StreamHandler;
        httpd_register_uri_handler(server_, &ping);
        httpd_register_uri_handler(server_, &cam_on);
        httpd_register_uri_handler(server_, &cam_off);
        httpd_register_uri_handler(server_, &cap);
        httpd_register_uri_handler(server_, &strm);
        ESP_LOGI(TAG, "Jarvis welfare web server started on port 80 (/ping /camera/on /capture /stream /camera/off)");
    }

    // ---- Cloud relay: poll the deployed dashboard for ping/camera, push JPEG photos up ----
    // No LAN IP needed — the necklace reaches the cloud outbound, so the caregiver can see
    // the senior from anywhere. The LAN HTTP server above stays as a same-Wi-Fi fallback.

    static bool PollCloud(const char* lan_ip, bool& ping, bool& camera) {
        auto http = Board::GetInstance().GetNetwork()->CreateHttp(3);
        std::string url = std::string(YODA_CLOUD_BASE) + "/api/device/poll?senior=" + YODA_SENIOR_ID
                          + "&ip=" + lan_ip + "&token=" + YODA_DEVICE_TOKEN;
        if (!http->Open("GET", url)) { http->Close(); return false; }
        int code = http->GetStatusCode();
        std::string body = http->ReadAll();
        http->Close();
        if (code != 200) { ESP_LOGW(TAG, "relay poll HTTP %d", code); return false; }
        ping = body.find("\"ping\":true") != std::string::npos;
        camera = body.find("\"camera\":true") != std::string::npos;
        return true;
    }

    static void PushFrame() {
        if (s_camera == nullptr) return;
        std::string jpeg;
        if (!s_camera->CaptureToJpeg(jpeg) || jpeg.empty()) { ESP_LOGW(TAG, "relay: capture failed"); return; }
        size_t n = jpeg.size();
        auto http = Board::GetInstance().GetNetwork()->CreateHttp(3);
        std::string url = std::string(YODA_CLOUD_BASE) + "/api/device/frame?senior=" + YODA_SENIOR_ID
                          + "&token=" + YODA_DEVICE_TOKEN;
        http->SetHeader("Content-Type", "image/jpeg");
        http->SetContent(std::move(jpeg));
        if (!http->Open("POST", url)) { http->Close(); ESP_LOGW(TAG, "relay: frame POST open failed"); return; }
        int code = http->GetStatusCode();
        http->Close();
        ESP_LOGI(TAG, "relay: pushed frame %u bytes (HTTP %d)", (unsigned)n, code);
    }

    void WelfareRelayLoop(const char* lan_ip) {
        bool announced = false;     // play the privacy announce once per camera session
        bool camera_active = false; // is the caregiver actively viewing right now?
        while (true) {
            // Only reach the cloud when she's idle — never contend with an active voice conversation
            // over the single radio/TLS stack (that contention caused the SSL -76 read errors).
            camera_active = false;
            if (Application::GetInstance().GetDeviceState() == kDeviceStateIdle) {
                bool ping = false, camera = false;
                if (PollCloud(lan_ip, ping, camera)) {
                    if (ping) {
                        std::string_view checkin(checking_ogg_start, (size_t)(checking_ogg_end - checking_ogg_start));
                        Application::GetInstance().PlaySound(checkin);
                        ESP_LOGI(TAG, "relay: ping -> check-in announce");
                    }
                    if (camera) {
                        camera_active = true;
                        if (!announced) {
                            std::string_view checking(checking_ogg_start, (size_t)(checking_ogg_end - checking_ogg_start));
                            Application::GetInstance().PlaySound(checking);
                            announced = true;
                            ESP_LOGI(TAG, "relay: camera on -> privacy announce");
                            vTaskDelay(pdMS_TO_TICKS(2500));  // let the announce finish before the first photo
                        }
                        PushFrame();  // one frame per poll — never hog the radio/CPU (keeps the wake word alive)
                    } else {
                        announced = false;  // reset for the next camera session
                    }
                }
            } else {
                announced = false;  // a conversation interrupted; re-announce next camera session
            }
            // CRITICAL: a fresh TLS handshake every poll is CPU-heavy and starves the on-chip
            // wake-word detector. While idle (99% of the time) poll gently so "Jarvis" always
            // lands; only speed up while the caregiver is actively viewing the camera.
            vTaskDelay(pdMS_TO_TICKS(camera_active ? 2000 : 15000));
        }
    }

    // Wait for the STA IP, then poll the cloud forever (self-reports the LAN IP for the fallback).
    void InitializeWelfareRelay() {
        xTaskCreate([](void* arg) {
            auto* self = static_cast<YodaPendant*>(arg);
            esp_netif_ip_info_t ip = {};
            while (true) {
                esp_netif_t* netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
                if (netif != nullptr && esp_netif_get_ip_info(netif, &ip) == ESP_OK && ip.ip.addr != 0) break;
                vTaskDelay(pdMS_TO_TICKS(1000));
            }
            char ipbuf[16] = {};
            esp_ip4addr_ntoa(&ip.ip, ipbuf, sizeof(ipbuf));
            ESP_LOGI(TAG, "=== JARVIS RELAY: polling cloud at %s (caregiver sees her from anywhere) ===", YODA_CLOUD_BASE);
            self->WelfareRelayLoop(ipbuf);
            vTaskDelete(nullptr);
        }, "jarvis_relay", 8192, this, 4, nullptr);
    }

    // httpd needs lwip/tcpip ready, which is NOT the case in the board constructor.
    // Wait (in a task) until the STA has an IP, then start the server and log the IP.
    void InitializeWebServer() {
        xTaskCreate([](void* arg) {
            auto* self = static_cast<YodaPendant*>(arg);
            esp_netif_ip_info_t ip = {};
            while (true) {
                esp_netif_t* netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
                if (netif != nullptr && esp_netif_get_ip_info(netif, &ip) == ESP_OK && ip.ip.addr != 0) {
                    break;
                }
                vTaskDelay(pdMS_TO_TICKS(1000));
            }
            char ipbuf[16] = {};
            esp_ip4addr_ntoa(&ip.ip, ipbuf, sizeof(ipbuf));
            self->StartWebServer();
            ESP_LOGI(TAG, "=== JARVIS WELFARE: device IP = %s  (enter this in the dashboard) ===", ipbuf);
            vTaskDelete(nullptr);
        }, "jarvis_web_wait", 4096, this, 5, nullptr);
    }

public:
    YodaPendant() : boot_button_(BOOT_BUTTON_GPIO) {
        // Quiet the noisy framework tags so the serial monitor stays readable for verification.
        // Idle relay poll (every 15s) floods with TLS/HTTP + free-sram lines; camera streaming
        // additionally floods with AFE ringbuffer + keep-alive teardown noise. All cosmetic — the
        // relay reports real success/failure itself under the "JarvisPendant" tag.
        esp_log_level_set("esp-x509-crt-bundle", ESP_LOG_WARN);
        esp_log_level_set("SystemInfo", ESP_LOG_WARN);
        // Camera-streaming noise: the AFE mic feed overflows while the CPU is busy pushing
        // JPEG-over-TLS (wake-word simply pauses during a caregiver-triggered camera check — not a fault).
        esp_log_level_set("AFE", ESP_LOG_ERROR);
        esp_log_level_set("Esp32Camera", ESP_LOG_WARN);
        // Benign HTTPS keep-alive teardown between frame pushes (the server closes the socket after the
        // POST already returned HTTP 200). Silence the layers that log the closed socket as an error.
        esp_log_level_set("HttpClient", ESP_LOG_NONE);
        esp_log_level_set("esp-tls-mbedtls", ESP_LOG_NONE);
        esp_log_level_set("EspSsl", ESP_LOG_NONE);
        esp_log_level_set("Dynamic Impl", ESP_LOG_NONE);
        InitializeButtons();
        InitializeCamera();
        InitializeWebServer();
        InitializeWelfareRelay();
    }

    virtual AudioCodec* GetAudioCodec() override {
        static NoAudioCodecSimplexPdm audio_codec(
            AUDIO_INPUT_SAMPLE_RATE, AUDIO_OUTPUT_SAMPLE_RATE,
            AUDIO_I2S_SPK_GPIO_BCLK, AUDIO_I2S_SPK_GPIO_LRCK, AUDIO_I2S_SPK_GPIO_DOUT,
            I2S_STD_SLOT_BOTH,  // duplicate mono to L+R so the amp hears it whichever channel its
                                // SD pin selects (MAX98357A picks L/R/mixed by SD voltage)
            AUDIO_I2S_MIC_GPIO_CLK, AUDIO_I2S_MIC_GPIO_DIN);
        return &audio_codec;
    }

    virtual Camera* GetCamera() override {
        return camera_;
    }
};

DECLARE_BOARD(YodaPendant);
