#ifndef SCK_AUDIO_BRIDGE_H
#define SCK_AUDIO_BRIDGE_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef void (*sck_audio_callback_t)(
    const float *samples,
    uint32_t count,
    uint32_t sample_rate,
    uint32_t channels,
    void *context
);

typedef struct SCKAudioBridgeHandle SCKAudioBridgeHandle;

bool sck_audio_is_supported(void);
bool sck_audio_has_permission(void);

SCKAudioBridgeHandle *sck_audio_start(
    uint32_t sample_rate,
    sck_audio_callback_t callback,
    void *context,
    char *err_buf,
    size_t err_buf_len
);

void sck_audio_stop(SCKAudioBridgeHandle *handle);

#ifdef __cplusplus
}
#endif

#endif /* SCK_AUDIO_BRIDGE_H */
