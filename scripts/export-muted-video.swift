import AVFoundation
import Foundation

guard CommandLine.arguments.count == 3 else {
    fputs("Usage: export-muted-video.swift input output\n", stderr)
    exit(2)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let asset = AVURLAsset(url: inputURL)
let composition = AVMutableComposition()

guard let sourceVideo = asset.tracks(withMediaType: .video).first,
      let videoTrack = composition.addMutableTrack(
        withMediaType: .video,
        preferredTrackID: kCMPersistentTrackID_Invalid
      ) else {
    fputs("No video track found.\n", stderr)
    exit(3)
}

do {
    try videoTrack.insertTimeRange(
        CMTimeRange(start: .zero, duration: asset.duration),
        of: sourceVideo,
        at: .zero
    )
    videoTrack.preferredTransform = sourceVideo.preferredTransform
} catch {
    fputs("Unable to copy video track: \(error)\n", stderr)
    exit(4)
}

try? FileManager.default.removeItem(at: outputURL)
guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPreset1280x720) else {
    fputs("Unable to create exporter.\n", stderr)
    exit(5)
}

exporter.outputURL = outputURL
exporter.outputFileType = .mp4
exporter.shouldOptimizeForNetworkUse = true

let semaphore = DispatchSemaphore(value: 0)
exporter.exportAsynchronously { semaphore.signal() }
semaphore.wait()

if exporter.status != .completed {
    fputs("Export failed: \(exporter.error?.localizedDescription ?? "unknown error")\n", stderr)
    exit(6)
}

print(outputURL.path)
