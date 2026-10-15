#import "sck_audio_bridge.h"
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreAudio/CoreAudioTypes.h>
#import <CoreGraphics/CoreGraphics.h>
#include <string.h>

@interface SCKAudioReceiver : NSObject <SCStreamOutput>
@property (nonatomic, assign) sck_audio_callback_t callback;
@property (nonatomic, assign) void *context;
@property (nonatomic, assign) uint32_t targetSampleRate;
@end

@implementation SCKAudioReceiver

- (instancetype)initWithCallback:(sck_audio_callback_t)cb
                         context:(void *)ctx
                targetSampleRate:(uint32_t)rate {
    self = [super init];
    if (self) {
        _callback = cb;
        _context = ctx;
        _targetSampleRate = rate;
    }
    return self;
}

- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
    if (type != SCStreamOutputTypeAudio) {
        return;
    }
    if (!self.callback) {
        return;
    }

    CMAudioFormatDescriptionRef formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer);
    if (!formatDesc) {
        return;
    }

    const AudioStreamBasicDescription *asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc);
    if (!asbd) {
        return;
    }

    CMItemCount numSamples = CMSampleBufferGetNumSamples(sampleBuffer);
    if (numSamples <= 0) {
        return;
    }

    AudioBufferList bufferList;
    CMBlockBufferRef blockBuffer = NULL;
    OSStatus status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sampleBuffer,
        NULL,
        &bufferList,
        sizeof(bufferList),
        NULL,
        NULL,
        0,
        &blockBuffer
    );

    if (status != noErr || !blockBuffer) {
        if (blockBuffer) {
            CFRelease(blockBuffer);
        }
        return;
    }

    uint32_t channels = asbd->mChannelsPerFrame > 0 ? asbd->mChannelsPerFrame : 1;
    uint32_t sampleRate = (uint32_t)(asbd->mSampleRate > 0 ? asbd->mSampleRate : self.targetSampleRate);

    // If already float format:
    BOOL isFloat = (asbd->mFormatFlags & kAudioFormatFlagIsFloat) != 0;
    BOOL isBigEndian = (asbd->mFormatFlags & kAudioFormatFlagIsBigEndian) != 0;

    // Buffer list may contain 1 or more buffers depending on interleaved/non-interleaved
    if (bufferList.mNumberBuffers > 0 && bufferList.mBuffers[0].mData != NULL) {
        float *convertedSamples = NULL;
        uint32_t totalSamples = 0;

        if (isFloat && !isBigEndian && channels == 1 && bufferList.mNumberBuffers == 1) {
            // Fast path: already mono 32-bit float
            float *src = (float *)bufferList.mBuffers[0].mData;
            uint32_t count = bufferList.mBuffers[0].mDataByteSize / sizeof(float);
            self.callback(src, count, sampleRate, 1, self.context);
        } else if (isFloat && !isBigEndian) {
            // Multi-channel float -> downmix to mono
            uint32_t frames = (uint32_t)numSamples;
            convertedSamples = (float *)malloc(frames * sizeof(float));
            if (convertedSamples) {
                if (bufferList.mNumberBuffers >= channels) {
                    // Non-interleaved channels
                    for (uint32_t i = 0; i < frames; i++) {
                        float sum = 0.0f;
                        for (uint32_t c = 0; c < channels; c++) {
                            float *chData = (float *)bufferList.mBuffers[c].mData;
                            sum += chData[i];
                        }
                        convertedSamples[i] = sum / (float)channels;
                    }
                } else {
                    // Interleaved channels in buffer 0
                    float *interleaved = (float *)bufferList.mBuffers[0].mData;
                    for (uint32_t i = 0; i < frames; i++) {
                        float sum = 0.0f;
                        for (uint32_t c = 0; c < channels; c++) {
                            sum += interleaved[i * channels + c];
                        }
                        convertedSamples[i] = sum / (float)channels;
                    }
                }
                totalSamples = frames;
                self.callback(convertedSamples, totalSamples, sampleRate, 1, self.context);
                free(convertedSamples);
            }
        } else if (!isFloat && asbd->mBitsPerChannel == 16) {
            // 16-bit signed integer -> convert and downmix to float
            uint32_t frames = (uint32_t)numSamples;
            convertedSamples = (float *)malloc(frames * sizeof(float));
            if (convertedSamples) {
                int16_t *src = (int16_t *)bufferList.mBuffers[0].mData;
                for (uint32_t i = 0; i < frames; i++) {
                    float sum = 0.0f;
                    for (uint32_t c = 0; c < channels; c++) {
                        sum += (float)src[i * channels + c] / 32768.0f;
                    }
                    convertedSamples[i] = sum / (float)channels;
                }
                totalSamples = frames;
                self.callback(convertedSamples, totalSamples, sampleRate, 1, self.context);
                free(convertedSamples);
            }
        }
    }

    CFRelease(blockBuffer);
}

@end

struct SCKAudioBridgeHandle {
    SCStream *stream;
    SCKAudioReceiver *receiver;
    dispatch_queue_t queue;
    BOOL isRunning;
};

bool sck_audio_is_supported(void) {
    if (@available(macOS 13.0, *)) {
        return true;
    }
    return false;
}

bool sck_audio_has_permission(void) {
    return CGPreflightScreenCaptureAccess();
}

static void copy_error(char *err_buf, size_t err_buf_len, const char *msg) {
    if (err_buf && err_buf_len > 0) {
        strncpy(err_buf, msg, err_buf_len - 1);
        err_buf[err_buf_len - 1] = '\0';
    }
}

SCKAudioBridgeHandle *sck_audio_start(
    uint32_t sample_rate,
    sck_audio_callback_t callback,
    void *context,
    char *err_buf,
    size_t err_buf_len
) {
    if (!sck_audio_is_supported()) {
        copy_error(err_buf, err_buf_len, "ScreenCaptureKit audio requires macOS 13.0 or later");
        return NULL;
    }

    if (!sck_audio_has_permission()) {
        copy_error(err_buf, err_buf_len, "Screen Recording permission not granted for ScreenCaptureKit");
        return NULL;
    }

    __block SCShareableContent *content = nil;
    __block NSError *contentError = nil;
    dispatch_semaphore_t sema = dispatch_semaphore_create(0);

    [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent * _Nullable c, NSError * _Nullable e) {
        content = c;
        contentError = e;
        dispatch_semaphore_signal(sema);
    }];

    // Wait up to 3 seconds for shareable content
    intptr_t waitRes = dispatch_semaphore_wait(sema, dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC));
    if (waitRes != 0 || contentError != nil || content == nil) {
        copy_error(err_buf, err_buf_len, contentError ? [[contentError localizedDescription] UTF8String] : "Timeout querying shareable content");
        return NULL;
    }

    if (content.displays.count == 0) {
        copy_error(err_buf, err_buf_len, "No active displays found for ScreenCaptureKit capture");
        return NULL;
    }

    SCDisplay *primaryDisplay = content.displays.firstObject;
    SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:primaryDisplay excludingWindows:@[]];

    SCStreamConfiguration *config = [[SCStreamConfiguration alloc] init];
    config.capturesAudio = YES;
    config.excludesCurrentProcessAudio = YES;
    config.sampleRate = (NSInteger)sample_rate;
    config.channelCount = 1; // mono
    config.width = 2;
    config.height = 2;
    config.minimumFrameInterval = CMTimeMake(1, 1);
    config.queueDepth = 5;

    SCKAudioReceiver *receiver = [[SCKAudioReceiver alloc] initWithCallback:callback context:context targetSampleRate:sample_rate];
    SCStream *stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:nil];

    dispatch_queue_t audioQueue = dispatch_queue_create("com.sidekick.sck.audio_stream", DISPATCH_QUEUE_SERIAL);
    NSError *outputError = nil;
    BOOL addSuccess = [stream addStreamOutput:receiver type:SCStreamOutputTypeAudio sampleHandlerQueue:audioQueue error:&outputError];
    if (!addSuccess || outputError) {
        copy_error(err_buf, err_buf_len, outputError ? [[outputError localizedDescription] UTF8String] : "Failed to add audio stream output");
        return NULL;
    }

    __block NSError *startError = nil;
    dispatch_semaphore_t startSema = dispatch_semaphore_create(0);

    [stream startCaptureWithCompletionHandler:^(NSError * _Nullable e) {
        startError = e;
        dispatch_semaphore_signal(startSema);
    }];

    intptr_t startWait = dispatch_semaphore_wait(startSema, dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC));
    if (startWait != 0 || startError != nil) {
        copy_error(err_buf, err_buf_len, startError ? [[startError localizedDescription] UTF8String] : "Timeout starting ScreenCaptureKit audio stream");
        [stream removeStreamOutput:receiver type:SCStreamOutputTypeAudio error:nil];
        return NULL;
    }

    SCKAudioBridgeHandle *handle = (SCKAudioBridgeHandle *)malloc(sizeof(SCKAudioBridgeHandle));
    if (!handle) {
        copy_error(err_buf, err_buf_len, "Out of memory allocating SCKAudioBridgeHandle");
        [stream stopCaptureWithCompletionHandler:nil];
        return NULL;
    }

    handle->stream = stream;
    handle->receiver = receiver;
    handle->queue = audioQueue;
    handle->isRunning = YES;

    return handle;
}

void sck_audio_stop(SCKAudioBridgeHandle *handle) {
    if (!handle) {
        return;
    }

    handle->isRunning = NO;

    // 1. Immediately nullify receiver callback and context so any in-flight frames are dropped
    if (handle->receiver) {
        handle->receiver.callback = NULL;
        handle->receiver.context = NULL;
    }

    // 2. Stop capture stream with low latency (<25ms timeout for panic purge compliance)
    if (handle->stream) {
        if (handle->receiver) {
            [handle->stream removeStreamOutput:handle->receiver type:SCStreamOutputTypeAudio error:nil];
        }
        dispatch_semaphore_t stopSema = dispatch_semaphore_create(0);
        [handle->stream stopCaptureWithCompletionHandler:^(NSError * _Nullable error) {
            (void)error;
            dispatch_semaphore_signal(stopSema);
        }];
        // Wait up to 20ms (< 25ms) for graceful stop, never blocking emergency panic purge
        dispatch_semaphore_wait(stopSema, dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_MSEC));
        handle->stream = nil;
    }

    // 3. Drain and flush any pending blocks on the audio dispatch queue before releasing resources
    if (handle->queue) {
        dispatch_sync(handle->queue, ^{});
    }

    handle->receiver = nil;
    handle->queue = nil;

    free(handle);
}
