const { createFFmpeg, fetchFile } = FFmpeg; // Use FFmpeg directly if loaded via <script>

// --- DOM Elements ---
const videoFileInput = document.getElementById('videoFile');
const jsonFileInput = document.getElementById('jsonFile');
const subtitleFileInput = document.getElementById('subtitleFile');
const modeKeepRadio = document.getElementById('modeKeep');
const processButton = document.getElementById('processButton');
const statusDiv = document.getElementById('status').querySelector('p');
const progressBar = document.getElementById('progressBar');
const downloadArea = document.getElementById('downloadArea');
const ffmpegLogPre = document.getElementById('ffmpeg-log').querySelector('pre');

// --- State ---
let ffmpeg = null;
let videoFile = null;
let editData = null;
let subtitleFile = null;
let isFFmpegLoaded = false;
let isProcessing = false;

// --- FFmpeg Setup ---
async function loadFFmpeg() {
    statusDiv.textContent = 'Loading FFmpeg core (~30MB)... Please wait.';
    try {
        ffmpeg = createFFmpeg({
            // log: true, // Enable basic logging to console
            logger: ({ type, message }) => { // Capture detailed logs
                // Filter out progress messages from detailed log view
                if (type !== 'fferr' || !message.includes('frame=') ) {
                     ffmpegLogPre.textContent += message + '\n';
                     ffmpegLogPre.scrollTop = ffmpegLogPre.scrollHeight; // Auto-scroll
                }
            },
            progress: ({ ratio }) => {
                if (ratio >= 0 && ratio <= 1) {
                    progressBar.style.display = 'block';
                    progressBar.value = ratio * 100;
                    statusDiv.textContent = `Processing: ${(ratio * 100).toFixed(1)}%`;
                     // Update overall progress if multi-stage
                    updateOverallProgress(ratio);
                } else {
                     // Hide progress bar if ratio is invalid (e.g., during setup)
                     // progressBar.style.display = 'none';
                }
            },
             corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js', // Specify core path
        });
        await ffmpeg.load();
        isFFmpegLoaded = true;
        statusDiv.textContent = 'FFmpeg loaded. Ready for files.';
        updateButtonState();
    } catch (error) {
        console.error("FFmpeg loading error:", error);
        statusDiv.textContent = 'Error loading FFmpeg. Check console/network tab.';
        alert(`Failed to load FFmpeg: ${error}. Try reloading the page or check browser compatibility (requires Wasm support).`);
    }
}

// --- File Handling ---
videoFileInput.addEventListener('change', (e) => {
    videoFile = e.target.files[0];
    statusDiv.textContent = 'Video file selected.';
    updateButtonState();
});

jsonFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        editData = JSON.parse(text);
        // Basic validation
        if (!editData.clips || !Array.isArray(editData.clips) || !editData.video?.media?.video?.duration || !editData.video?.media?.video?.timecode?.rate?.timebase) {
            throw new Error("Invalid JSON format. Missing required fields (clips, duration, timebase).");
        }
        statusDiv.textContent = 'JSON file loaded and parsed.';
        updateButtonState();
    } catch (error) {
        console.error("JSON parsing error:", error);
        statusDiv.textContent = `Error reading JSON: ${error.message}`;
        editData = null;
        alert(`Error processing JSON file: ${error.message}`);
    }
});

subtitleFileInput.addEventListener('change', (e) => {
    subtitleFile = e.target.files[0];
    statusDiv.textContent = 'Subtitle file selected.';
    // No button state change needed for optional file
});

// --- UI Updates ---
function updateButtonState() {
    if (isFFmpegLoaded && videoFile && editData && !isProcessing) {
        processButton.disabled = false;
        processButton.textContent = 'Process Video';
    } else if (isProcessing) {
         processButton.disabled = true;
         processButton.textContent = 'Processing...';
    }
     else {
        processButton.disabled = true;
         processButton.textContent = isFFmpegLoaded ? 'Load Video & JSON' : 'Loading FFmpeg...';
    }
}

function setLoadingState(loading, message = '') {
    isProcessing = loading;
    updateButtonState();
    statusDiv.textContent = message;
    progressBar.style.display = loading ? 'block' : 'none';
    progressBar.value = 0;
     if (loading) {
         ffmpegLogPre.textContent = ''; // Clear log on new process
         downloadArea.innerHTML = ''; // Clear previous download links
     }
}

// --- Core Logic ---
processButton.addEventListener('click', async () => {
    if (!videoFile || !editData || !isFFmpegLoaded || isProcessing) return;

    setLoadingState(true, 'Starting processing...');

    try {
        const mode = modeKeepRadio.checked ? 'keep' : 'remove';
        const frameRate = editData.video.media.video.timecode.rate.timebase;
        const totalDurationFrames = editData.video.media.video.duration;
        const totalDurationSec = totalDurationFrames / frameRate;

        // 1. Calculate Segments to Keep (in seconds)
        const segmentsToKeep = calculateKeepSegments(editData.clips, mode, frameRate, totalDurationSec);
        if (segmentsToKeep.length === 0) {
            throw new Error("No segments to keep after processing rules.");
        }

        statusDiv.textContent = `Calculated ${segmentsToKeep.length} segment(s) to keep.`;
        console.log("Segments to keep (seconds):", segmentsToKeep);

        // 2. Write input video to FFmpeg's virtual filesystem
        const inputFilename = 'input.mp4';
        statusDiv.textContent = 'Loading video into memory...';
        ffmpeg.FS('writeFile', inputFilename, await fetchFile(videoFile));
        statusDiv.textContent = 'Video loaded. Starting FFmpeg...';


        // 3. Process Video Segments (Extract and Concat)
        const outputFilename = `output_${Date.now()}.mp4`;
        const segmentFiles = [];
        const concatListFilename = 'mylist.txt';
        let concatFileContent = '';

        // --- Multi-stage progress tracking ---
        const totalStages = segmentsToKeep.length + 1; // N extractions + 1 concat
        let currentStage = 0;
        window.updateOverallProgress = (stageRatio) => {
            const overallRatio = (currentStage + stageRatio) / totalStages;
             progressBar.value = overallRatio * 100;
             statusDiv.textContent = `Processing: Stage ${currentStage + 1}/${totalStages} (${(overallRatio * 100).toFixed(1)}%)`;
        };
        // --- ---

        // Extract each segment
        for (let i = 0; i < segmentsToKeep.length; i++) {
            currentStage = i;
            const segment = segmentsToKeep[i];
            const start = segment.start.toFixed(6); // Use high precision
            const duration = (segment.end - segment.start).toFixed(6);
            const tempOutputFilename = `segment_${i}.mp4`;

            statusDiv.textContent = `Extracting segment ${i + 1}/${segmentsToKeep.length}... (Start: ${start}s, Duration: ${duration}s)`;
            console.log(`Running FFmpeg for segment ${i}: -ss ${start} -i ${inputFilename} -t ${duration} -c copy -map 0 -avoid_negative_ts make_zero ${tempOutputFilename}`);

            // FFmpeg command to extract one segment losslessly
            // -ss BEFORE -i: Faster seeking, might be less accurate for some formats but generally good for MP4.
            // -t duration: Specify duration to extract.
            // -c copy: Lossless copy of video and audio streams.
            // -map 0: Include all streams from input (video, audio, data).
            // -avoid_negative_ts make_zero: Helps prevent timestamp issues when concatenating later.
            await ffmpeg.run(
                '-ss', start,        // Seek to start time (input option)
                '-i', inputFilename,
                '-t', duration,      // Specify duration (output option relative to -ss)
                '-c', 'copy',        // Copy codecs losslessly
                '-map', '0',         // Map all streams
                '-avoid_negative_ts', 'make_zero', // Adjust timestamps to start near zero for concat
                tempOutputFilename
            );

            segmentFiles.push(tempOutputFilename);
            concatFileContent += `file '${tempOutputFilename}'\n`;
        }

        // Create the concat list file in FFmpeg's FS
        ffmpeg.FS('writeFile', concatListFilename, concatFileContent);

        // Concatenate segments
        currentStage = segmentsToKeep.length; // The final concat stage
        statusDiv.textContent = `Concatenating ${segmentFiles.length} segments...`;
        console.log(`Running FFmpeg for concat: -f concat -safe 0 -i ${concatListFilename} -c copy ${outputFilename}`);

        // FFmpeg command to concatenate using the demuxer (lossless)
        // -f concat: Use the concat demuxer.
        // -safe 0: Allow relative paths in the list file (needed for FS).
        // -i mylist.txt: Input file list.
        // -c copy: Lossless copy.
        await ffmpeg.run(
            '-f', 'concat',
            '-safe', '0',
            '-i', concatListFilename,
            '-c', 'copy',
            outputFilename
        );

        // 4. Retrieve Output Video
        statusDiv.textContent = 'Processing complete. Retrieving output file...';
        const outputData = ffmpeg.FS('readFile', outputFilename);

        // 5. Create Download Link for Video
        createDownloadLink(outputData, outputFilename, 'video/mp4');
        statusDiv.textContent = 'Processed video ready for download!';


        // 6. (Optional) Process Subtitles
        if (subtitleFile) {
            statusDiv.textContent = 'Processing subtitles...';
            try {
                 const subtitleText = await subtitleFile.text();
                 const subtitleType = subtitleFile.name.endsWith('.srt') ? 'srt' : 'vtt';
                 const processedSubs = processSubtitles(subtitleText, subtitleType, segmentsToKeep);
                 const subOutputFilename = `processed_subs_${Date.now()}.${subtitleType}`;
                 createDownloadLink(processedSubs, subOutputFilename, 'text/plain'); // Use text/plain or specific mime type
                 statusDiv.textContent += ' Processed subtitles ready!';
             } catch (subError) {
                 console.error("Subtitle processing error:", subError);
                 statusDiv.textContent += ` (Subtitle processing failed: ${subError.message})`;
            }
         }

        // 7. Cleanup FFmpeg virtual filesystem (optional, frees memory)
         try {
             ffmpeg.FS('unlink', inputFilename);
             ffmpeg.FS('unlink', concatListFilename);
             segmentFiles.forEach(fname => ffmpeg.FS('unlink', fname));
             ffmpeg.FS('unlink', outputFilename);
         } catch (unlinkError) {
             console.warn("Minor error during FS cleanup:", unlinkError); // Non-critical
         }


    } catch (error) {
        console.error("Processing Error:", error);
        statusDiv.textContent = `Error: ${error.message}. Check console for details.`;
        alert(`An error occurred during processing: ${error.message}`);
    } finally {
         setLoadingState(false, statusDiv.textContent); // Keep last status message
         window.updateOverallProgress = null; // Clear global helper
    }
});

// --- Helper Functions ---

function calculateKeepSegments(clips, mode, frameRate, totalDurationSec) {
    // Convert JSON clip frames to time segments in seconds
    const jsonSegments = clips.map(clip => ({
        start: clip.start / frameRate,
        end: clip.end / frameRate
    })).sort((a, b) => a.start - b.start); // Sort by start time

    if (mode === 'keep') {
        // Directly use the sorted, valid segments
         return jsonSegments.filter(seg => seg.start < totalDurationSec && seg.end > seg.start);
    } else { // mode === 'remove'
        let keepSegments = [];
        let lastEndTime = 0;

        // Iterate through the segments *to be removed*
        for (const removeSegment of jsonSegments) {
            // Ensure removal segment is within bounds and valid
            const removeStart = Math.max(0, removeSegment.start);
            const removeEnd = Math.min(totalDurationSec, removeSegment.end);

            if (removeStart < removeEnd) { // Only process valid removal segments
                 // Add the segment *before* the removal segment
                 if (removeStart > lastEndTime) {
                    keepSegments.push({ start: lastEndTime, end: removeStart });
                 }
                 // Update the start point for the *next* potential keep segment
                 lastEndTime = Math.max(lastEndTime, removeEnd);
            }
        }

        // Add the final segment *after* the last removal segment, if any space remains
        if (lastEndTime < totalDurationSec) {
            keepSegments.push({ start: lastEndTime, end: totalDurationSec });
        }

        // Filter out any tiny segments that might result from floating point inaccuracies
        return keepSegments.filter(seg => (seg.end - seg.start) > 0.01); // Keep segments > 10ms
    }
}

function createDownloadLink(data, filename, mimeType) {
    const blob = new Blob([data.buffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.textContent = `Download ${filename}`;
    downloadArea.appendChild(a);

     // Clean up the Object URL eventually (though browser often handles it on navigation)
     // Consider adding a button to explicitly revoke URLs if memory becomes an issue
     // Or revoke after a timeout: setTimeout(() => URL.revokeObjectURL(url), 60000);
}


// --- Subtitle Processing ---

// Simple time string (HH:MM:SS.ms or MM:SS.ms) to seconds converter
function timeToSeconds(timeStr) {
    const parts = timeStr.split(':');
    let seconds = 0;
    if (parts.length === 3) { // HH:MM:SS.ms
        seconds += parseFloat(parts[0]) * 3600;
        seconds += parseFloat(parts[1]) * 60;
        seconds += parseFloat(parts[2].replace(',', '.'));
    } else if (parts.length === 2) { // MM:SS.ms
        seconds += parseFloat(parts[0]) * 60;
        seconds += parseFloat(parts[1].replace(',', '.'));
    } else {
        // Potentially handle just seconds? Or throw error?
        console.warn("Unsupported time format:", timeStr);
        return NaN;
    }
    return seconds;
}

// Seconds to VTT/SRT time string (HH:MM:SS.ms)
function secondsToTime(totalSeconds, format = 'vtt') {
     if (isNaN(totalSeconds) || totalSeconds < 0) return `00:00:00${format === 'vtt' ? '.' : ','}000`;

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const milliseconds = Math.floor((totalSeconds % 1) * 1000);

    const sep = format === 'vtt' ? '.' : ',';

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${sep}${String(milliseconds).padStart(3, '0')}`;
}


function processSubtitles(subtitleText, type, keepSegments) {
    const lines = subtitleText.split(/\r?\n/);
    let outputLines = [];
    let currentTimeOffset = 0; // Amount to subtract from original times
    let lastKeepSegmentEnd = 0;
    let cue = null;
    const timePattern = /(\d{2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}[.,]\d{3})/; // Matches VTT/SRT timecodes

    if (type === 'vtt') {
         outputLines.push('WEBVTT\n'); // VTT Header
     }

    let segmentIndex = 0;
    let parsingCue = false;
    let cueText = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const timeMatch = line.match(timePattern);

        if (timeMatch) {
             // Finish previous cue if exists
             if (cue && cueText.length > 0) {
                 // Check if this cue belongs in the output
                 let { originalStart, originalEnd, adjustedStart, adjustedEnd, belongs } = checkAndAdjustCueTime(cue.originalStart, cue.originalEnd, keepSegments);
                 if (belongs) {
                      // Add previous lines (like cue number for SRT)
                      outputLines.push(...cue.headerLines);
                      // Add adjusted time line
                      outputLines.push(`${secondsToTime(adjustedStart, type)} --> ${secondsToTime(adjustedEnd, type)}`);
                      // Add text lines
                      outputLines.push(...cueText);
                      outputLines.push(''); // Blank line separator
                 }
             }

             // Start new cue parsing
             parsingCue = true;
             cueText = [];
             const originalStart = timeToSeconds(timeMatch[1]);
             const originalEnd = timeToSeconds(timeMatch[2]);
             cue = {
                 originalStart,
                 originalEnd,
                 headerLines: []
             };

              // Add lines BEFORE the timecode line (e.g., SRT cue number) to the header
              let j = i - 1;
              while (j >= 0 && lines[j].trim() !== '' && !lines[j].match(timePattern)) {
                   // Check if it's likely a cue number (SRT specific)
                   if (type === 'srt' && /^\d+$/.test(lines[j].trim())) {
                       cue.headerLines.unshift(lines[j].trim()); // Add cue number
                       break; // Assume only one line before time for SRT
                   } else if (type === 'vtt' && !lines[j].trim().includes('-->')) {
                        // Could be VTT cue identifiers or settings, capture them
                        cue.headerLines.unshift(lines[j].trim());
                   }
                   j--;
              }


         } else if (parsingCue && line === '') {
             // Blank line signifies end of current cue text
             parsingCue = false; // Will be processed on next time match or end of file

         } else if (parsingCue) {
             // Add text line to current cue
             cueText.push(line);
         } else if (!parsingCue && line !== '' && outputLines.length === (type === 'vtt' ? 1 : 0)) {
              // Capture potential extra header lines in VTT after WEBVTT line
              if (type === 'vtt' && !line.includes('-->')) {
                   outputLines.push(line);
                   outputLines.push(''); // Add blank line after header block if needed
              }
         }
    }

    // Process the very last cue if it exists
    if (cue && cueText.length > 0) {
         let { originalStart, originalEnd, adjustedStart, adjustedEnd, belongs } = checkAndAdjustCueTime(cue.originalStart, cue.originalEnd, keepSegments);
         if (belongs) {
             outputLines.push(...cue.headerLines);
             outputLines.push(`${secondsToTime(adjustedStart, type)} --> ${secondsToTime(adjustedEnd, type)}`);
             outputLines.push(...cueText);
             outputLines.push('');
         }
    }


    return outputLines.join('\n');
}


// Checks if a cue's time range overlaps with any keep segment and calculates adjusted times
function checkAndAdjustCueTime(originalStart, originalEnd, keepSegments) {
    let cumulativeDurationBefore = 0;
    let belongs = false;
    let adjustedStart = NaN;
    let adjustedEnd = NaN;

     for (const segment of keepSegments) {
         const segmentDuration = segment.end - segment.start;

         // Calculate overlap range
         const overlapStart = Math.max(originalStart, segment.start);
         const overlapEnd = Math.min(originalEnd, segment.end);

         if (overlapStart < overlapEnd) { // They overlap
             belongs = true;

             // Calculate adjusted times relative to the start of the concatenated output
             // The start time is the time *within* the segment plus the duration of all *previous* segments.
             const startWithinSegment = overlapStart - segment.start;
             const endWithinSegment = overlapEnd - segment.start;


            // Important: Only set adjustedStart the *first* time an overlap is found
             if (isNaN(adjustedStart)) {
                 adjustedStart = cumulativeDurationBefore + startWithinSegment;
             }
             // Always update adjustedEnd to the latest point in the concatenated timeline
             adjustedEnd = cumulativeDurationBefore + endWithinSegment;

            // Don't break here, a single cue might span across *multiple* keep segments
             // if there was a removal in between. The adjustedEnd needs to account for this.
        }

        // Add this segment's duration to the cumulative offset for the next iteration
        cumulativeDurationBefore += segmentDuration;
    }

     // Ensure end time is not before start time (can happen with tiny overlaps/rounding)
     if (belongs && adjustedEnd <= adjustedStart) {
          adjustedEnd = adjustedStart + 0.001; // Make it slightly longer
     }


    return { originalStart, originalEnd, adjustedStart, adjustedEnd, belongs };
}


// --- Initial Load ---
loadFFmpeg();