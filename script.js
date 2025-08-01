// --- script.js ---

// Updated to work with FFmpeg.wasm v0.12.15
// Wait for DOM and FFmpeg to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM loaded. Checking FFmpeg...");
    
    // Different ways to access FFmpeg methods based on version
    let createFFmpeg, fetchFile;
    
    try {
        // For v0.12.x the import might be different
        if (typeof FFmpeg !== 'undefined') {
            console.log("FFmpeg global object found, accessing methods...");
            if (FFmpeg.FFmpeg) {
                // v0.12.x structure
                createFFmpeg = FFmpeg.FFmpeg.createFFmpeg;
                fetchFile = FFmpeg.FFmpeg.fetchFile;
                console.log("Accessed FFmpeg methods via FFmpeg.FFmpeg");
            } else if (FFmpeg.createFFmpeg) {
                // v0.11.x structure
                createFFmpeg = FFmpeg.createFFmpeg;
                fetchFile = FFmpeg.fetchFile;
                console.log("Accessed FFmpeg methods via direct FFmpeg object");
            } else {
                throw new Error("FFmpeg global object exists but doesn't have expected methods");
            }
        } else {
            console.error("FFmpeg global object not defined");
            // Try check for @ffmpeg/ffmpeg module in window
            if (typeof window !== 'undefined' && window.FFmpeg) {
                createFFmpeg = window.FFmpeg.createFFmpeg;
                fetchFile = window.FFmpeg.fetchFile;
                console.log("Accessed FFmpeg methods via window.FFmpeg");
            } else {
                throw new Error("Unable to find FFmpeg methods in global scope");
            }
        }
        
        // Initialize app with the detected methods
        initializeApp(createFFmpeg, fetchFile);
    } catch (error) {
        console.error("Critical error initializing FFmpeg:", error);
        const statusDiv = document.getElementById('status')?.querySelector('p');
        if (statusDiv) {
            statusDiv.textContent = 'Error: Failed to initialize FFmpeg library. Please check console.';
            statusDiv.style.color = 'red';
        }
        
        const processButton = document.getElementById('processButton');
        if (processButton) {
            processButton.disabled = true;
            processButton.textContent = 'FFmpeg Error';
        }
        
        alert(`Failed to initialize FFmpeg: ${error.message}\n\nPlease try refreshing the page or check your browser console for more details.`);
    }
});

function initializeApp(createFFmpeg, fetchFile) {
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
        statusDiv.textContent = 'Loading FFmpeg core... Please wait.';
        ffmpegLogPre.textContent = 'Initializing FFmpeg...\n'; // Clear log initially
        try {
            ffmpeg = createFFmpeg({
                log: true, // Enable basic logging to console for debugging
                logger: ({ type, message }) => { // Capture detailed logs
                    // Filter out progress messages from detailed log view if desired
                    if (type !== 'fferr' || !message.includes('frame=')) {
                         // Append messages, ensuring Scroll Height works correctly
                         ffmpegLogPre.textContent += message + '\n';
                        // Debounce or throttle scrolling updates if performance is an issue
                        requestAnimationFrame(() => {
                          ffmpegLogPre.scrollTop = ffmpegLogPre.scrollHeight; // Auto-scroll
                        });
                    }
                },
                progress: ({ ratio }) => {
                    if (isFinite(ratio) && ratio >= 0 && ratio <= 1) {
                        progressBar.style.display = 'block';
                        progressBar.value = ratio * 100;
                        // statusDiv.textContent = `Processing: ${(ratio * 100).toFixed(1)}%`;
                        // Use the multi-stage progress updater instead
                        if (typeof window.updateOverallProgress === 'function') {
                             updateOverallProgress(ratio);
                        } else {
                             // Fallback if the updater isn't set yet
                             statusDiv.textContent = `Processing: ${(ratio * 100).toFixed(1)}%`;
                        }
                    } else if (ratio === undefined || ratio < 0){
                        // This can happen e.g. during initial setup before real processing
                        // console.log("FFmpeg progress ratio invalid:", ratio);
                    }
                },
                // corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js', // Explicitly specifying core
                // --- IMPORTANT ---
                // We COMMENT OUT corePath to let the ffmpeg.js loader (v0.12+)
                // attempt to automatically select the correct core (single-threaded)
                // when SharedArrayBuffer is not available (like on standard GitHub Pages).
                // Ensure you've updated the script tag in index.html to v0.12.0 or later.
            });
            await ffmpeg.load();
            isFFmpegLoaded = true;
            statusDiv.textContent = 'FFmpeg loaded. Ready for files.';
            ffmpegLogPre.textContent += 'FFmpeg core loaded successfully.\n';
            updateButtonState();
        } catch (error) {
            console.error("FFmpeg loading error:", error);
            statusDiv.textContent = 'Error loading FFmpeg. Check console.';
            ffmpegLogPre.textContent += `Error loading FFmpeg: ${error}\n`;
            // Provide a more informative alert, referencing the SharedArrayBuffer issue
            alert(`Failed to load FFmpeg: ${error}. This often happens on platforms like GitHub Pages that don't enable SharedArrayBuffer by default. Try a different browser or consider hosting on a platform that allows setting COOP/COEP headers (like Netlify, Vercel, Cloudflare Pages).`);
            isFFmpegLoaded = false; // Ensure state is correct
            updateButtonState(); // Update button state to reflect loading failure
        }
    }

    // --- File Handling ---
    videoFileInput.addEventListener('change', (e) => {
        console.log('Video file input changed.');
        videoFile = e.target.files[0];
         if (videoFile) {
            console.log('Video file assigned:', videoFile.name);
            statusDiv.textContent = `Video: ${videoFile.name}`;
        } else {
            console.log('No video file selected.');
            statusDiv.textContent = 'Waiting for files...';
        }
        updateButtonState();
    });

    jsonFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        console.log('JSON file input changed.');
        editData = null; // Reset edit data first
        if (!file) {
             console.log('No JSON file selected.');
             updateButtonState(); // Update button state even if file is removed
            return;
        }
        try {
            console.log('Reading JSON file text:', file.name);
            const text = await file.text();
            console.log('Parsing JSON text...');
            editData = JSON.parse(text);
            console.log('JSON parsed successfully.');

            // Basic validation
            if (!editData.clips || !Array.isArray(editData.clips) || 
                !editData.video?.file?.media?.video?.duration || 
                !editData.video?.file?.media?.video?.timecode?.rate?.timebase) {
                throw new Error("Invalid JSON format. Missing required fields (clips array, video.file.media.video.duration, video.file.media.video.timecode.rate.timebase).");
            }
            console.log('JSON validation passed.');
            statusDiv.textContent = 'Video & JSON loaded.';
            updateButtonState();
        } catch (error) {
            console.error("JSON processing error in listener:", error);
            statusDiv.textContent = `Error reading JSON: ${error.message}`;
            editData = null;
            alert(`Error processing JSON file: ${error.message}. Please check the file content and structure.`);
            updateButtonState(); // Ensure button state updates after error
        }
    });


    subtitleFileInput.addEventListener('change', (e) => {
        console.log('Subtitle file input changed.');
        subtitleFile = e.target.files[0];
         if (subtitleFile) {
             console.log('Subtitle file assigned:', subtitleFile.name);
             statusDiv.textContent = 'Video, JSON & Subtitles loaded.'; // Adjust status
         } else {
             console.log('No subtitle file selected.');
              // Adjust status if other files are loaded
              if (videoFile && editData) {
                   statusDiv.textContent = 'Video & JSON loaded.';
              }
         }
        // No button state change needed for optional file, but update status text potentially
    });

    // --- UI Updates ---
    function updateButtonState() {
        // Debugging logs
        // console.log(`Updating button state: isFFmpegLoaded=${isFFmpegLoaded}, videoFile=${!!videoFile}, editData=${!!editData}, isProcessing=${isProcessing}`);

        if (isFFmpegLoaded && videoFile && editData && !isProcessing) {
            processButton.disabled = false;
            processButton.textContent = 'Process Video';
        } else {
            processButton.disabled = true;
            if (isProcessing) {
                 processButton.textContent = 'Processing...';
            } else if (!isFFmpegLoaded) {
                 processButton.textContent = 'Loading FFmpeg...';
            } else if (!videoFile) {
                processButton.textContent = 'Upload Video File';
            } else if (!editData) {
                processButton.textContent = 'Upload JSON File';
            } else {
                processButton.textContent = 'Load Files First'; // Fallback
            }
        }
    }


    function setLoadingState(loading, message = '') {
        isProcessing = loading;
        updateButtonState();
        statusDiv.textContent = message;
        progressBar.value = 0; // Reset progress bar
        progressBar.style.display = loading ? 'block' : 'none';
         if (loading) {
             ffmpegLogPre.textContent = ''; // Clear log on new process start
             downloadArea.innerHTML = ''; // Clear previous download links
         }
    }

    // --- Core Logic ---
    processButton.addEventListener('click', async () => {
        if (!videoFile || !editData || !isFFmpegLoaded || isProcessing) {
            console.warn("Processing attempted but conditions not met.");
            return;
        }

        setLoadingState(true, 'Starting processing...');
        ffmpegLogPre.textContent = 'Processing started...\n'; // Clear log for new run

        // --- Multi-stage progress tracking ---
        let totalStages = 1; // Default to 1 stage if calculation fails
        let currentStage = 0;
        let segmentsToKeep = []; // Define here for scope access
        window.updateOverallProgress = (stageRatio) => {
            // Ensure stageRatio is a valid number between 0 and 1
            const validStageRatio = isFinite(stageRatio) && stageRatio >= 0 && stageRatio <= 1 ? stageRatio : 0;
            const overallRatio = (currentStage + validStageRatio) / totalStages;
            const overallPercentage = Math.min(100, Math.max(0, overallRatio * 100)); // Clamp between 0 and 100
             progressBar.value = overallPercentage;
             statusDiv.textContent = `Processing: Stage ${currentStage + 1}/${totalStages} (${overallPercentage.toFixed(1)}%)`;
        };
        // --- ---

        try {
            const mode = modeKeepRadio.checked ? 'keep' : 'remove';
            const frameRate = editData.video.file.media.video.timecode.rate.timebase;
            const totalDurationFrames = editData.video.file.media.video.duration;

            if (!frameRate || typeof frameRate !== 'number' || frameRate <= 0) {
                throw new Error(`Invalid frame rate (${frameRate}) in JSON data.`);
            }
             if (!totalDurationFrames || typeof totalDurationFrames !== 'number' || totalDurationFrames <= 0) {
                 throw new Error(`Invalid total duration (${totalDurationFrames}) in JSON data.`);
             }

            const totalDurationSec = totalDurationFrames / frameRate;

            // 1. Calculate Segments to Keep (in seconds)
            segmentsToKeep = calculateKeepSegments(editData.clips, mode, frameRate, totalDurationSec); // Assign to outer scope variable
            if (segmentsToKeep.length === 0) {
                throw new Error("No segments to keep after applying rules. Check JSON and mode.");
            }

            statusDiv.textContent = `Calculated ${segmentsToKeep.length} segment(s) to keep.`;
            console.log("Segments to keep (seconds):", segmentsToKeep);
            ffmpegLogPre.textContent += `Calculated ${segmentsToKeep.length} segment(s) to keep.\n`;

            // Update total stages for progress calculation
            totalStages = segmentsToKeep.length + 1; // N extractions + 1 concat

            // 2. Write input video to FFmpeg's virtual filesystem
            const inputFilename = 'input.mp4'; // Use a fixed name
            ffmpegLogPre.textContent += 'Writing video to FFmpeg memory...\n';
            statusDiv.textContent = 'Loading video into memory...';
            // Ensure file system is clean before writing potentially large file
            try {
                 if (ffmpeg.FS('readdir', '/').includes(inputFilename)) {
                     ffmpeg.FS('unlink', inputFilename);
                     console.log('Removed existing input file from FS.');
                 }
             } catch (e) { /* Ignore if file doesn't exist */ }

            ffmpeg.FS('writeFile', inputFilename, await fetchFile(videoFile));
            statusDiv.textContent = 'Video loaded. Starting FFmpeg processing...';
            ffmpegLogPre.textContent += 'Video written to memory. Starting segment extraction...\n';


            // 3. Process Video Segments (Extract and Concat)
            const outputFilename = `output_${Date.now()}.mp4`;
            const segmentFiles = [];
            const concatListFilename = 'mylist.txt';
            let concatFileContent = '';

            // Extract each segment
            for (let i = 0; i < segmentsToKeep.length; i++) {
                currentStage = i; // Progress tracking: current stage index (0-based)
                const segment = segmentsToKeep[i];
                const start = segment.start.toFixed(6); // Use high precision
                const duration = (segment.end - segment.start).toFixed(6);
                const tempOutputFilename = `segment_${i}.mp4`;

                // Check for near-zero or negative duration
                if (parseFloat(duration) <= 0.001) {
                    console.warn(`Skipping very short or zero-duration segment ${i + 1}`);
                    ffmpegLogPre.textContent += `Skipping very short segment ${i+1} (duration: ${duration}s)\n`;
                    // Adjust total stages if skipping
                    totalStages--;
                    continue;
                }


                statusDiv.textContent = `Extracting segment ${i + 1}/${segmentsToKeep.length}...`;
                ffmpegLogPre.textContent += `\n--- Extracting segment ${i + 1} ---\nStart: ${start}s, Duration: ${duration}s\nOutput: ${tempOutputFilename}\n`;
                console.log(`Running FFmpeg for segment ${i}: -ss ${start} -i ${inputFilename} -t ${duration} -c copy -map 0 -avoid_negative_ts make_zero ${tempOutputFilename}`);


                 // Ensure temp file system is clean
                 try {
                     if (ffmpeg.FS('readdir', '/').includes(tempOutputFilename)) {
                         ffmpeg.FS('unlink', tempOutputFilename);
                     }
                 } catch(e) { /* Ignore */ }

                // FFmpeg command to extract one segment losslessly
                await ffmpeg.run(
                    '-ss', start,        // Seek to start time (input option)
                    '-i', inputFilename,
                    '-t', duration,      // Specify duration (output option relative to -ss)
                    '-c', 'copy',        // Copy codecs losslessly
                    '-map', '0',         // Map all streams (video, audio, potentially data)
                    '-avoid_negative_ts', 'make_zero', // Adjust timestamps to start near zero for concat
                     '-movflags', '+faststart', // Ensures moov atom is at the beginning (good practice)
                    tempOutputFilename
                );
                ffmpegLogPre.textContent += `Segment ${i+1} extracted.\n`;
                segmentFiles.push(tempOutputFilename);
                concatFileContent += `file '${tempOutputFilename}'\n`;
            }

             // Adjust total stages if some were skipped
             totalStages = segmentFiles.length + 1;

            if (segmentFiles.length === 0) {
                 throw new Error("No valid segments were extracted.");
             } else if (segmentFiles.length === 1) {
                // If only one segment, just rename it, no need to concat
                statusDiv.textContent = 'Only one segment, renaming...';
                ffmpegLogPre.textContent += '\n--- Only one segment, renaming ---\n';
                ffmpeg.FS('rename', segmentFiles[0], outputFilename);
                ffmpegLogPre.textContent += `Renamed ${segmentFiles[0]} to ${outputFilename}\n`;

             } else {
                 // Create the concat list file in FFmpeg's FS
                 ffmpegLogPre.textContent += '\n--- Concatenating segments ---\n';
                 ffmpeg.FS('writeFile', concatListFilename, concatFileContent);
                 ffmpegLogPre.textContent += `Created ${concatListFilename}\n`;

                 // Concatenate segments
                 currentStage = segmentFiles.length; // The final concat stage (0-based index)
                 statusDiv.textContent = `Concatenating ${segmentFiles.length} segments...`;
                 console.log(`Running FFmpeg for concat: -f concat -safe 0 -i ${concatListFilename} -c copy ${outputFilename}`);
                 ffmpegLogPre.textContent += `Running concat command...\n`;

                  // Ensure output file doesn't exist
                 try {
                     if (ffmpeg.FS('readdir', '/').includes(outputFilename)) {
                         ffmpeg.FS('unlink', outputFilename);
                     }
                 } catch(e) { /* Ignore */ }

                 // FFmpeg command to concatenate using the demuxer (lossless)
                 await ffmpeg.run(
                     '-f', 'concat',
                     '-safe', '0', // Allow relative paths in the list file (needed for FS)
                     '-i', concatListFilename,
                     '-c', 'copy', // Lossless copy
                      '-movflags', '+faststart', // Good practice for web video
                     outputFilename
                 );
                 ffmpegLogPre.textContent += `Concatenation complete: ${outputFilename}\n`;
             }

            // 4. Retrieve Output Video
            statusDiv.textContent = 'Processing complete. Retrieving output file...';
            ffmpegLogPre.textContent += 'Reading output file from memory...\n';
            const outputData = ffmpeg.FS('readFile', outputFilename);

            // 5. Create Download Link for Video
            createDownloadLink(outputData, outputFilename, 'video/mp4');
            statusDiv.textContent = 'Processed video ready for download!';
            ffmpegLogPre.textContent += 'Video download link created.\n';


            // 6. (Optional) Process Subtitles
            if (subtitleFile) {
                statusDiv.textContent = 'Processing subtitles...';
                ffmpegLogPre.textContent += '\n--- Processing Subtitles ---\n';
                try {
                     const subtitleText = await subtitleFile.text();
                     const subtitleType = subtitleFile.name.toLowerCase().endsWith('.srt') ? 'srt' : 'vtt';
                     ffmpegLogPre.textContent += `Type: ${subtitleType}, Original file: ${subtitleFile.name}\n`;
                     const processedSubs = processSubtitles(subtitleText, subtitleType, segmentsToKeep);
                     const subOutputFilename = `processed_subs_${Date.now()}.${subtitleType}`;
                     createDownloadLink(processedSubs, subOutputFilename, `text/${subtitleType}`); // Use specific mime type
                     statusDiv.textContent = 'Video & Subtitles ready for download!';
                     ffmpegLogPre.textContent += `Processed subtitles ready: ${subOutputFilename}\n`;
                 } catch (subError) {
                     console.error("Subtitle processing error:", subError);
                     statusDiv.textContent += ` (Subtitle processing failed: ${subError.message})`;
                     ffmpegLogPre.textContent += `ERROR processing subtitles: ${subError.message}\n`;
                }
             }

            // 7. Cleanup FFmpeg virtual filesystem (important for memory)
             ffmpegLogPre.textContent += '\n--- Cleaning up memory ---\n';
             try {
                 ffmpeg.FS('unlink', inputFilename);
                  ffmpegLogPre.textContent += `Unlinked ${inputFilename}\n`;
                 if (segmentFiles.length > 1) {
                     ffmpeg.FS('unlink', concatListFilename);
                     ffmpegLogPre.textContent += `Unlinked ${concatListFilename}\n`;
                 }
                 segmentFiles.forEach(fname => {
                     try {
                        ffmpeg.FS('unlink', fname);
                         ffmpegLogPre.textContent += `Unlinked ${fname}\n`;
                     } catch (e) { console.warn(`Minor error unlinking segment ${fname}:`, e); }
                 });
                 ffmpeg.FS('unlink', outputFilename);
                  ffmpegLogPre.textContent += `Unlinked ${outputFilename}\n`;
             } catch (unlinkError) {
                 console.warn("Minor error during FS cleanup:", unlinkError);
                  ffmpegLogPre.textContent += `Warning during cleanup: ${unlinkError.message}\n`;
             }


        } catch (error) {
            console.error("Processing Error:", error);
            statusDiv.textContent = `Error: ${error.message}. Check console & log.`;
            ffmpegLogPre.textContent += `\n\n ***** PROCESSING ERROR *****\n${error.stack || error.message}\n`;
            alert(`An error occurred during processing: ${error.message}`);
        } finally {
            setLoadingState(false, statusDiv.textContent); // Keep last status message
            window.updateOverallProgress = null; // Clear global helper
             ffmpegLogPre.textContent += '\nProcessing routine finished.\n';
             requestAnimationFrame(() => { // Ensure scroll happens after final text update
                 ffmpegLogPre.scrollTop = ffmpegLogPre.scrollHeight;
             });
        }
    });

    // --- Helper Functions ---

    function calculateKeepSegments(clips, mode, frameRate, totalDurationSec) {
        // Validate clips structure
         if (!clips || !Array.isArray(clips)) {
             throw new Error("Invalid 'clips' data in JSON.");
         }

        // Convert JSON clip frames to time segments in seconds
        const jsonSegments = clips.map((clip, index) => {
             // Add validation for individual clip structure
             if (typeof clip.start !== 'number' || typeof clip.end !== 'number') {
                 throw new Error(`Invalid start/end type in clip index ${index}. Expected numbers.`);
             }
             if (clip.start < 0 || clip.end < 0) {
                 throw new Error(`Negative start/end frame in clip index ${index}.`);
             }
             if (clip.end <= clip.start) {
                 console.warn(`Clip index ${index} has end frame <= start frame (${clip.end} <= ${clip.start}). It will be ignored or result in zero duration.`);
             }

            return {
                start: clip.start / frameRate,
                end: clip.end / frameRate
            };
         }).sort((a, b) => a.start - b.start); // Sort by start time is crucial

        let keepSegments = [];

        if (mode === 'keep') {
            // Directly use the sorted, valid segments, merging overlapping/touching ones
            if (jsonSegments.length === 0) return [];

            let currentSegment = { ...jsonSegments[0] }; // Start with the first

             for (let i = 1; i < jsonSegments.length; i++) {
                 const nextSegment = jsonSegments[i];
                 // Merge if next starts at or before current ends
                 if (nextSegment.start <= currentSegment.end) {
                     currentSegment.end = Math.max(currentSegment.end, nextSegment.end); // Extend end
                 } else {
                     // If gap, push the completed current segment and start a new one
                     if (currentSegment.end > currentSegment.start) { // Ensure non-zero duration
                         keepSegments.push({
                             start: Math.max(0, currentSegment.start), // Clamp start at 0
                             end: Math.min(totalDurationSec, currentSegment.end) // Clamp end at total duration
                         });
                     }
                     currentSegment = { ...nextSegment };
                 }
             }
             // Push the last processed segment
             if (currentSegment.end > currentSegment.start) {
                 keepSegments.push({
                     start: Math.max(0, currentSegment.start),
                     end: Math.min(totalDurationSec, currentSegment.end)
                 });
             }

        } else { // mode === 'remove'
            let lastEndTime = 0;

            // Iterate through the segments *to be removed* (ensure they are merged/sorted first)
            // Merging removal segments prevents issues with overlapping removals
            let mergedRemoveSegments = [];
             if (jsonSegments.length > 0) {
                let currentRemove = { ...jsonSegments[0] };
                 for (let i = 1; i < jsonSegments.length; i++) {
                     const nextRemove = jsonSegments[i];
                     if (nextRemove.start <= currentRemove.end) {
                         currentRemove.end = Math.max(currentRemove.end, nextRemove.end);
                     } else {
                          if (currentRemove.end > currentRemove.start) mergedRemoveSegments.push(currentRemove);
                          currentRemove = { ...nextRemove };
                     }
                 }
                  if (currentRemove.end > currentRemove.start) mergedRemoveSegments.push(currentRemove);
             }


            for (const removeSegment of mergedRemoveSegments) {
                // Ensure removal segment is within bounds and valid
                const removeStart = Math.max(0, removeSegment.start);
                const removeEnd = Math.min(totalDurationSec, removeSegment.end);

                if (removeStart < removeEnd) { // Only process valid removal segments
                     // Add the segment *before* this removal segment
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
        }
            // Final filter for tiny segments and ensure start < end strictly
            return keepSegments.filter(seg => (seg.end - seg.start) > 0.001 && seg.start < totalDurationSec);
    }


    function createDownloadLink(data, filename, mimeType) {
        // Ensure data is ArrayBuffer or Blob
        let blob;
        if (data instanceof Blob) {
            blob = data;
        } else if (data instanceof Uint8Array) {
             blob = new Blob([data.buffer], { type: mimeType });
        } else if (typeof data === 'string') {
             blob = new Blob([data], { type: mimeType });
        }
         else {
            console.error("Cannot create download link for data type:", typeof data);
            return;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.textContent = `Download ${filename}`;
        a.style.display = 'block'; // Make sure it's visible
        a.style.margin = '10px 0';
        a.style.padding = '10px';
        a.style.border = '1px solid #ccc';
        a.style.borderRadius = '4px';
        a.style.textDecoration = 'none';
        a.style.backgroundColor = '#eee';
        a.style.color = '#333';


        // Add event listener to revoke URL after download is initiated
        a.addEventListener('click', () => {
            // Revoke after a short delay to ensure download starts
            setTimeout(() => URL.revokeObjectURL(url), 100);
        });

        downloadArea.appendChild(a);
    }


    // --- Subtitle Processing ---

    // Simple time string (HH:MM:SS.ms or MM:SS.ms or H:MM:SS.ms etc) to seconds converter
    function timeToSeconds(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return NaN;
        const parts = timeStr.split(':');
        let seconds = 0;
        const msSeparator = timeStr.includes(',') ? ',' : '.'; // Handle both SRT and VTT separators
        try {
            if (parts.length === 3) { // H:MM:SS.ms
                const secParts = parts[2].split(msSeparator);
                seconds += parseInt(parts[0], 10) * 3600;
                seconds += parseInt(parts[1], 10) * 60;
                seconds += parseInt(secParts[0], 10);
                if (secParts.length > 1) seconds += parseInt(secParts[1].padEnd(3, '0'), 10) / 1000;
            } else if (parts.length === 2) { // MM:SS.ms
                const secParts = parts[1].split(msSeparator);
                seconds += parseInt(parts[0], 10) * 60;
                seconds += parseInt(secParts[0], 10);
                if (secParts.length > 1) seconds += parseInt(secParts[1].padEnd(3, '0'), 10) / 1000;
            } else {
                console.warn("Unsupported time format:", timeStr);
                return NaN;
            }
            return seconds;
        } catch (e) {
             console.warn("Error parsing time string:", timeStr, e);
             return NaN;
        }
    }


    // Seconds to VTT/SRT time string (HH:MM:SS.ms)
    function secondsToTime(totalSeconds, format = 'vtt') {
         if (isNaN(totalSeconds) || totalSeconds < 0) return `00:00:00${format === 'vtt' ? '.' : ','}000`;

        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = Math.floor(totalSeconds % 60);
        const milliseconds = Math.round((totalSeconds % 1) * 1000); // Use round for better accuracy

        const sep = format === 'vtt' ? '.' : ',';

        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${sep}${String(milliseconds).padStart(3, '0')}`;
    }


    function processSubtitles(subtitleText, type, keepSegments) {
        const lines = subtitleText.split(/\r?\n/);
        let outputLines = [];
        let cue = null;
        // Matches VTT/SRT timecodes, allowing for variations in hours digits
        const timePattern = /(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{1,2}:\d{2}:\d{2}[.,]\d{3})/;

        if (type === 'vtt') {
             outputLines.push('WEBVTT'); // VTT Header is mandatory
             // Look for potential VTT header metadata immediately after WEBVTT
             let i = 1;
             while(lines[i] && lines[i].trim() !== '' && !lines[i].match(timePattern)) {
                 outputLines.push(lines[i]);
                 i++;
             }
             outputLines.push(''); // Ensure blank line after header block
         }

        // Use English state names for better code clarity
        let parsingState = 'looking_for_cue_id_or_time';
        let cueHeaderLines = [];
        let cueTextLines = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]; // Don't trim yet, preserve potential VTT metadata spacing
            const trimmedLine = line.trim();
            const timeMatch = trimmedLine.match(timePattern);

            // --- State Machine Logic ---

            if (parsingState === 'looking_for_cue_id_or_time') {
                if (trimmedLine === '') {
                     continue; // Skip blank lines between cues
                 } else if (timeMatch) {
                     // Found time directly (likely SRT or simple VTT)
                     parsingState = 'looking_for_text';
                     cue = {
                        originalStart: timeToSeconds(timeMatch[1]),
                        originalEnd: timeToSeconds(timeMatch[2]),
                        headerLines: cueHeaderLines, // Capture preceding lines (like SRT number)
                        timeLine: line // Store the original time line format
                     };
                     cueHeaderLines = []; // Reset for next cue
                     cueTextLines = [];
                 } else {
                     // Assume it's a cue identifier (SRT number or VTT ID)
                     cueHeaderLines.push(line);
                     parsingState = 'looking_for_time';
                 }
            } else if (parsingState === 'looking_for_time') {
                if (timeMatch) {
                     parsingState = 'looking_for_text';
                     cue = {
                        originalStart: timeToSeconds(timeMatch[1]),
                        originalEnd: timeToSeconds(timeMatch[2]),
                        headerLines: cueHeaderLines,
                        timeLine: line // Store the original time line format
                     };
                     cueHeaderLines = []; // Reset
                     cueTextLines = [];
                 } else if (trimmedLine === '') {
                     // Invalid structure? Blank line after identifier but before time. Reset.
                     console.warn("Subtitle Parse Warning: Blank line encountered after identifier but before timecode near line:", i);
                     parsingState = 'looking_for_cue_id_or_time';
                     cueHeaderLines = []; // Discard potentially partial cue header
                 } else {
                     // Could be multi-line VTT identifier or settings, keep accumulating header lines
                      cueHeaderLines.push(line);
                      // Stay in 'looking_for_time' state
                 }
            } else if (parsingState === 'looking_for_text') {
                 if (trimmedLine === '') {
                     // End of the current cue text block
                     if (cue) {
                         // Process the completed cue
                         let { adjustedStart, adjustedEnd, belongs } = checkAndAdjustCueTime(cue.originalStart, cue.originalEnd, keepSegments);
                         if (belongs && !isNaN(adjustedStart) && !isNaN(adjustedEnd)) {
                              // Reconstruct timing line with original formatting but adjusted times
                             const adjustedTimeLine = cue.timeLine.replace(timePattern, `${secondsToTime(adjustedStart, type)} --> ${secondsToTime(adjustedEnd, type)}`);

                             outputLines.push(...cue.headerLines); // Add ID/number lines
                             outputLines.push(adjustedTimeLine); // Add adjusted time line
                             outputLines.push(...cueTextLines); // Add text lines
                             outputLines.push(''); // Add blank line separator
                         }
                         cue = null; // Reset cue
                     }
                     parsingState = 'looking_for_cue_id_or_time'; // Ready for the next cue identifier/time
                     cueHeaderLines = []; // Reset headers just in case
                     cueTextLines = [];
                 } else {
                     // Add text line to current cue
                     cueTextLines.push(line);
                 }
            }
        }

        // Process the very last cue if the file didn't end with a blank line
        if (parsingState === 'looking_for_text' && cue && cueTextLines.length > 0) {
             let { adjustedStart, adjustedEnd, belongs } = checkAndAdjustCueTime(cue.originalStart, cue.originalEnd, keepSegments);
             if (belongs && !isNaN(adjustedStart) && !isNaN(adjustedEnd)) {
                 const adjustedTimeLine = cue.timeLine.replace(timePattern, `${secondsToTime(adjustedStart, type)} --> ${secondsToTime(adjustedEnd, type)}`);
                 outputLines.push(...cue.headerLines);
                 outputLines.push(adjustedTimeLine);
                 outputLines.push(...cueTextLines);
                 // No final blank line needed if it's the absolute end of the file content
             }
        }


        return outputLines.join('\n');
    }


    // Checks if a cue's time range overlaps with any keep segment and calculates adjusted times
    function checkAndAdjustCueTime(originalStart, originalEnd, keepSegments) {
        if (isNaN(originalStart) || isNaN(originalEnd)) {
             console.warn("Invalid original cue times:", originalStart, originalEnd);
             return { adjustedStart: NaN, adjustedEnd: NaN, belongs: false };
        }

        let cumulativeDurationBefore = 0;
        let belongs = false;
        let firstOverlap = true;
        let adjustedStart = NaN;
        let adjustedEnd = NaN;

         for (const segment of keepSegments) {
             const segmentDuration = segment.end - segment.start;
             if (segmentDuration <= 0) continue; // Skip zero-duration keep segments

             // Calculate overlap range [overlapStart, overlapEnd)
             const overlapStart = Math.max(originalStart, segment.start);
             const overlapEnd = Math.min(originalEnd, segment.end);

             // Check if there is a valid overlap (start must be strictly less than end)
             if (overlapStart < overlapEnd) {
                 belongs = true;

                 // Calculate times relative to the start of the concatenated output
                 const startWithinSegment = overlapStart - segment.start;
                 const endWithinSegment = overlapEnd - segment.start;

                 // Only set adjustedStart based on the *first* segment this cue overlaps with
                 if (firstOverlap) {
                     adjustedStart = cumulativeDurationBefore + startWithinSegment;
                     firstOverlap = false;
                 }
                 // Always update adjustedEnd to the end point within the *current* overlapping segment,
                 // relative to the concatenated timeline. This handles cues spanning removed sections.
                 adjustedEnd = cumulativeDurationBefore + endWithinSegment;

                // Don't break. A cue might appear again if it spans a removed section.
                // The logic correctly updates adjustedEnd based on the latest overlapping part.
            }

            // Add this keep segment's duration to the cumulative offset for the next segment.
            cumulativeDurationBefore += segmentDuration;
        }

         // Post-processing checks
         if (belongs) {
              // Ensure end time is strictly greater than start time
              if (adjustedEnd <= adjustedStart) {
                 // If they are equal or inverted due to precision, add a minimal duration (e.g., 1ms)
                 adjustedEnd = adjustedStart + 0.001;
                 console.warn(`Adjusted cue end time <= start time. Setting minimal duration. Original: ${originalStart}-${originalEnd}, Adjusted: ${adjustedStart}-${adjustedEnd}`);
              }
         } else {
             // If it never overlapped, ensure times are NaN
             adjustedStart = NaN;
             adjustedEnd = NaN;
         }


        return { originalStart, originalEnd, adjustedStart, adjustedEnd, belongs };
    }

    // Initialize FFmpeg
    loadFFmpeg();
}
