// --- script.js --- Single-threaded version

// This version uses the single-threaded core of FFmpeg.wasm
// which doesn't require SharedArrayBuffer and works on GitHub Pages
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM loaded. Checking FFmpeg...");
    
    // Check if FFmpeg is available (different check approach for v0.11.0)
    if (typeof FFmpeg === 'undefined' || !FFmpeg.createFFmpeg) {
        console.error("CRITICAL: FFmpeg global object or createFFmpeg not defined. Check script tag in index.html.");
        // Display a user-friendly error on the page
        const statusDiv = document.getElementById('status')?.querySelector('p');
        if (statusDiv) {
            statusDiv.textContent = 'Error: Failed to load core video library. Please reload.';
            statusDiv.style.color = 'red';
        }
        // Disable further interaction
        const processButton = document.getElementById('processButton');
        if (processButton) {
            processButton.disabled = true;
            processButton.textContent = 'Load Error';
        }
    } else {
        console.log("FFmpeg global object found. Initializing application...");
        initializeApp();
    }
});

function initializeApp() {
    const { createFFmpeg, fetchFile } = FFmpeg;

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
        ffmpegLogPre.textContent = 'Initializing FFmpeg...\n';
        try {
            // Use single-threaded core that doesn't require SharedArrayBuffer
            ffmpeg = createFFmpeg({
                corePath: 'https://unpkg.com/@ffmpeg/core-st@0.11.0/dist/ffmpeg-core.js',
                log: true,
                logger: ({ message }) => {
                    // Simplified logging for v0.11.0
                    if (!message.includes('frame=')) {
                        ffmpegLogPre.textContent += message + '\n';
                        requestAnimationFrame(() => {
                            ffmpegLogPre.scrollTop = ffmpegLogPre.scrollHeight;
                        });
                    }
                },
                progress: ({ ratio }) => {
                    if (isFinite(ratio) && ratio >= 0 && ratio <= 1) {
                        progressBar.style.display = 'block';
                        progressBar.value = ratio * 100;
                        if (typeof window.updateOverallProgress === 'function') {
                            updateOverallProgress(ratio);
                        } else {
                            statusDiv.textContent = `Processing: ${(ratio * 100).toFixed(1)}%`;
                        }
                    }
                },
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
            alert(`Failed to load FFmpeg: ${error}. Try using Chrome or Edge for better compatibility.`);
            isFFmpegLoaded = false;
            updateButtonState();
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
            videoFile = null;
        }
        updateButtonState();
    });

    jsonFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        console.log('JSON file input changed.');
        editData = null; // Reset edit data first
        if (!file) {
            console.log('No JSON file selected.');
            updateButtonState();
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
                !editData.video?.media?.video?.duration || 
                !editData.video?.media?.video?.timecode?.rate?.timebase) {
                throw new Error("Invalid JSON format. Missing required fields (clips array, video.media.video.duration, video.media.video.timecode.rate.timebase).");
            }
            console.log('JSON validation passed.');
            // Adjust status text based on whether video is also loaded
            statusDiv.textContent = videoFile ? 'Video & JSON loaded.' : 'JSON loaded. Upload Video.';
            updateButtonState();
        } catch (error) {
            console.error("JSON processing error in listener:", error);
            statusDiv.textContent = `Error reading JSON: ${error.message}`;
            editData = null;
            alert(`Error processing JSON file: ${error.message}. Please check the file content and structure.`);
            updateButtonState();
        }
    });

    subtitleFileInput.addEventListener('change', (e) => {
        console.log('Subtitle file input changed.');
        subtitleFile = e.target.files[0];
        if (subtitleFile) {
            console.log('Subtitle file assigned:', subtitleFile.name);
            // Adjust status based on other files
            if (videoFile && editData) {
                statusDiv.textContent = 'Video, JSON & Subtitles loaded.';
            } else if (videoFile) {
                statusDiv.textContent = 'Video & Subtitles loaded.';
            } else if (editData) {
                statusDiv.textContent = 'JSON & Subtitles loaded.';
            } else {
                statusDiv.textContent = 'Subtitles loaded.';
            }
        } else {
            console.log('No subtitle file selected.');
            subtitleFile = null;
            // Adjust status if other files are loaded
            if (videoFile && editData) {
                statusDiv.textContent = 'Video & JSON loaded.';
            } else if (videoFile) {
                statusDiv.textContent = `Video: ${videoFile.name}`;
            } else if (editData) {
                statusDiv.textContent = 'JSON loaded. Upload Video.';
            } else {
                statusDiv.textContent = 'Waiting for files...';
            }
        }
    });

    // --- UI Updates ---
    function updateButtonState() {
        if (!isFFmpegLoaded && !isProcessing) {
            processButton.disabled = true;
            processButton.textContent = 'Loading FFmpeg...';
            return;
        }

        if (isFFmpegLoaded && videoFile && editData && !isProcessing) {
            processButton.disabled = false;
            processButton.textContent = 'Process Video';
        } else {
            processButton.disabled = true;
            if (isProcessing) {
                processButton.textContent = 'Processing...';
            } else if (!videoFile) {
                processButton.textContent = 'Upload Video File';
            } else if (!editData) {
                processButton.textContent = 'Upload JSON File';
            } else {
                processButton.textContent = 'Initializing...';
            }
        }
    }

    function setLoadingState(loading, message = '') {
        isProcessing = loading;
        updateButtonState();
        statusDiv.textContent = message;
        progressBar.value = 0;
        progressBar.style.display = loading ? 'block' : 'none';
        if (loading) {
            ffmpegLogPre.textContent = '';
            downloadArea.innerHTML = '';
        }
    }

    // --- Core Logic ---
    processButton.addEventListener('click', async () => {
        if (!videoFile || !editData || !isFFmpegLoaded || isProcessing) {
            console.warn("Processing attempted but conditions not met.");
            alert("Please ensure FFmpeg is loaded and both video and JSON files are selected.");
            return;
        }

        setLoadingState(true, 'Starting processing...');
        ffmpegLogPre.textContent = 'Processing started...\n';

        // --- Multi-stage progress tracking ---
        let totalStages = 1;
        let currentStage = 0;
        let segmentsToKeep = [];
        window.updateOverallProgress = (stageRatio) => {
            const validStageRatio = isFinite(stageRatio) && stageRatio >= 0 && stageRatio <= 1 ? stageRatio : 0;
            const overallRatio = (currentStage + validStageRatio) / totalStages;
            const overallPercentage = Math.min(100, Math.max(0, overallRatio * 100));
            progressBar.value = overallPercentage;
            statusDiv.textContent = `Processing: Stage ${currentStage + 1}/${totalStages} (${overallPercentage.toFixed(1)}%)`;
        };

        try {
            const mode = modeKeepRadio.checked ? 'keep' : 'remove';
            const frameRate = editData.video.media.video.timecode.rate.timebase;
            const totalDurationFrames = editData.video.media.video.duration;

            if (!frameRate || typeof frameRate !== 'number' || frameRate <= 0) {
                throw new Error(`Invalid frame rate (${frameRate}) in JSON data.`);
            }
            if (!totalDurationFrames || typeof totalDurationFrames !== 'number' || totalDurationFrames <= 0) {
                throw new Error(`Invalid total duration (${totalDurationFrames}) in JSON data.`);
            }

            const totalDurationSec = totalDurationFrames / frameRate;
            segmentsToKeep = calculateKeepSegments(editData.clips, mode, frameRate, totalDurationSec);
            if (segmentsToKeep.length === 0) {
                throw new Error("No segments to keep after applying rules. Check JSON and mode.");
            }

            statusDiv.textContent = `Calculated ${segmentsToKeep.length} segment(s) to keep.`;
            console.log("Segments to keep (seconds):", segmentsToKeep);
            ffmpegLogPre.textContent += `Calculated ${segmentsToKeep.length} segment(s) to keep.\n`;
            totalStages = segmentsToKeep.length + 1;

            const inputFilename = 'input.mp4';
            ffmpegLogPre.textContent += 'Writing video to FFmpeg memory...\n';
            statusDiv.textContent = 'Loading video into memory...';
            
            // File operations in v0.11.0 have slightly different error handling
            try { 
                const fileList = ffmpeg.FS('readdir', '/');
                if (fileList.includes(inputFilename)) {
                    ffmpeg.FS('unlink', inputFilename);
                }
            } catch (e) {
                console.log("No previous input file to unlink");
            }
            
            ffmpeg.FS('writeFile', inputFilename, await fetchFile(videoFile));
            statusDiv.textContent = 'Video loaded. Starting FFmpeg processing...';
            ffmpegLogPre.textContent += 'Video written to memory. Starting segment extraction...\n';

            const outputFilename = `output_${Date.now()}.mp4`;
            const segmentFiles = [];
            const concatListFilename = 'mylist.txt';
            let concatFileContent = '';

            for (let i = 0; i < segmentsToKeep.length; i++) {
                currentStage = i;
                const segment = segmentsToKeep[i];
                const start = segment.start.toFixed(6);
                const duration = (segment.end - segment.start).toFixed(6);
                const tempOutputFilename = `segment_${i}.mp4`;

                if (parseFloat(duration) <= 0.001) {
                    console.warn(`Skipping very short segment ${i + 1}`);
                    ffmpegLogPre.textContent += `Skipping very short segment ${i+1} (duration: ${duration}s)\n`;
                    totalStages = Math.max(1, totalStages - 1);
                    continue;
                }

                statusDiv.textContent = `Extracting segment ${i + 1}/${segmentsToKeep.length}...`;
                ffmpegLogPre.textContent += `\n--- Extracting segment ${i + 1} ---\nStart: ${start}s, Duration: ${duration}s\nOutput: ${tempOutputFilename}\n`;
                
                try {
                    const fileList = ffmpeg.FS('readdir', '/');
                    if (fileList.includes(tempOutputFilename)) {
                        ffmpeg.FS('unlink', tempOutputFilename);
                    }
                } catch(e) {
                    console.log(`No previous ${tempOutputFilename} to unlink`);
                }

                // v0.11.0 requires each argument as a separate string
                await ffmpeg.run(
                    '-ss', start,
                    '-i', inputFilename,
                    '-t', duration,
                    '-c', 'copy',
                    '-map', '0',
                    '-avoid_negative_ts', 'make_zero',
                    '-movflags', '+faststart',
                    tempOutputFilename
                );
                
                ffmpegLogPre.textContent += `Segment ${i+1} extracted.\n`;
                segmentFiles.push(tempOutputFilename);
                concatFileContent += `file '${tempOutputFilename}'\n`;
            }

            totalStages = segmentFiles.length + (segmentFiles.length > 1 ? 1 : 0);

            if (segmentFiles.length === 0) {
                throw new Error("No valid segments were extracted.");
            } else if (segmentFiles.length === 1) {
                statusDiv.textContent = 'Only one segment, renaming...';
                ffmpegLogPre.textContent += '\n--- Only one segment, renaming ---\n';
                ffmpeg.FS('rename', segmentFiles[0], outputFilename);
                ffmpegLogPre.textContent += `Renamed ${segmentFiles[0]} to ${outputFilename}\n`;
            } else {
                ffmpegLogPre.textContent += '\n--- Concatenating segments ---\n';
                
                try {
                    const fileList = ffmpeg.FS('readdir', '/');
                    if (fileList.includes(concatListFilename)) {
                        ffmpeg.FS('unlink', concatListFilename);
                    }
                } catch(e) {
                    console.log(`No previous ${concatListFilename} to unlink`);
                }
                
                ffmpeg.FS('writeFile', concatListFilename, concatFileContent);
                ffmpegLogPre.textContent += `Created ${concatListFilename}\n`;
                currentStage = segmentFiles.length;
                statusDiv.textContent = `Concatenating ${segmentFiles.length} segments...`;
                console.log(`Running FFmpeg for concat: -f concat -safe 0 -i ${concatListFilename} -c copy ${outputFilename}`);
                ffmpegLogPre.textContent += `Running concat command...\n`;
                
                try {
                    const fileList = ffmpeg.FS('readdir', '/');
                    if (fileList.includes(outputFilename)) {
                        ffmpeg.FS('unlink', outputFilename);
                    }
                } catch(e) {
                    console.log(`No previous ${outputFilename} to unlink`);
                }

                await ffmpeg.run(
                    '-f', 'concat',
                    '-safe', '0',
                    '-i', concatListFilename,
                    '-c', 'copy',
                    '-movflags', '+faststart',
                    outputFilename
                );
                ffmpegLogPre.textContent += `Concatenation complete: ${outputFilename}\n`;
            }

            statusDiv.textContent = 'Processing complete. Retrieving output file...';
            ffmpegLogPre.textContent += 'Reading output file from memory...\n';
            const outputData = ffmpeg.FS('readFile', outputFilename);
            createDownloadLink(outputData, outputFilename, 'video/mp4');
            statusDiv.textContent = 'Processed video ready for download!';
            ffmpegLogPre.textContent += 'Video download link created.\n';

            if (subtitleFile) {
                statusDiv.textContent = 'Processing subtitles...';
                ffmpegLogPre.textContent += '\n--- Processing Subtitles ---\n';
                try {
                    const subtitleText = await subtitleFile.text();
                    const subtitleType = subtitleFile.name.toLowerCase().endsWith('.srt') ? 'srt' : 'vtt';
                    ffmpegLogPre.textContent += `Type: ${subtitleType}, Original file: ${subtitleFile.name}\n`;
                    const processedSubs = processSubtitles(subtitleText, subtitleType, segmentsToKeep);
                    const subOutputFilename = `processed_subs_${Date.now()}.${subtitleType}`;
                    createDownloadLink(processedSubs, subOutputFilename, `text/${subtitleType}`);
                    statusDiv.textContent = 'Video & Subtitles ready for download!';
                    ffmpegLogPre.textContent += `Processed subtitles ready: ${subOutputFilename}\n`;
                } catch (subError) {
                    console.error("Subtitle processing error:", subError);
                    statusDiv.textContent += ` (Subtitle processing failed: ${subError.message})`;
                    ffmpegLogPre.textContent += `ERROR processing subtitles: ${subError.message}\n`;
                }
            }

            ffmpegLogPre.textContent += '\n--- Cleaning up memory ---\n';
            
            // Cleanup - using try/catch for each file operation
            try { 
                ffmpeg.FS('unlink', inputFilename); 
                ffmpegLogPre.textContent += `Unlinked ${inputFilename}\n`; 
            } catch(e) {
                console.log(`Error unlinking ${inputFilename}:`, e);
            }
            
            if (segmentFiles.length > 1) { 
                try { 
                    ffmpeg.FS('unlink', concatListFilename); 
                    ffmpegLogPre.textContent += `Unlinked ${concatListFilename}\n`; 
                } catch(e) {
                    console.log(`Error unlinking ${concatListFilename}:`, e);
                }
            }
            
            segmentFiles.forEach(fname => { 
                try { 
                    ffmpeg.FS('unlink', fname); 
                    ffmpegLogPre.textContent += `Unlinked ${fname}\n`; 
                } catch (e) {
                    console.log(`Error unlinking ${fname}:`, e);
                } 
            });
            
            try { 
                ffmpeg.FS('unlink', outputFilename); 
                ffmpegLogPre.textContent += `Unlinked ${outputFilename}\n`; 
            } catch(e) {
                console.log(`Error unlinking ${outputFilename}:`, e);
            }

        } catch (error) {
            console.error("Processing Error:", error);
            statusDiv.textContent = `Error: ${error.message}. Check console & log.`;
            ffmpegLogPre.textContent += `\n\n ***** PROCESSING ERROR *****\n${error.stack || error.message}\n`;
            alert(`An error occurred during processing: ${error.message}`);
        } finally {
            setLoadingState(false, statusDiv.textContent);
            window.updateOverallProgress = null;
            ffmpegLogPre.textContent += '\nProcessing routine finished.\n';
            requestAnimationFrame(() => {
                ffmpegLogPre.scrollTop = ffmpegLogPre.scrollHeight;
            });
        }
    });

    // --- Helper Functions ---
    function calculateKeepSegments(clips, mode, frameRate, totalDurationSec) {
        if (!clips || !Array.isArray(clips)) {
            throw new Error("Invalid 'clips' data in JSON.");
        }
        
        const jsonSegments = clips.map((clip, index) => {
            if (typeof clip.start !== 'number' || typeof clip.end !== 'number') {
                throw new Error(`Invalid start/end type in clip index ${index}. Expected numbers.`);
            }
            if (clip.start < 0 || clip.end < 0) {
                throw new Error(`Negative start/end frame in clip index ${index}.`);
            }
            if (clip.end <= clip.start) {
                console.warn(`Clip index ${index} has end frame <= start frame (${clip.end} <= ${clip.start}).`);
            }
            return { start: clip.start / frameRate, end: clip.end / frameRate };
        }).sort((a, b) => a.start - b.start);

        let keepSegments = [];
        
        if (mode === 'keep') {
            if (jsonSegments.length === 0) return [];
            
            let currentSegment = { ...jsonSegments[0] };
            for (let i = 1; i < jsonSegments.length; i++) {
                const nextSegment = jsonSegments[i];
                if (nextSegment.start <= currentSegment.end + 0.001) {
                    currentSegment.end = Math.max(currentSegment.end, nextSegment.end);
                } else {
                    if (currentSegment.end > currentSegment.start) {
                        keepSegments.push({
                            start: Math.max(0, currentSegment.start),
                            end: Math.min(totalDurationSec, currentSegment.end)
                        });
                    }
                    currentSegment = { ...nextSegment };
                }
            }
            
            if (currentSegment.end > currentSegment.start) {
                keepSegments.push({
                    start: Math.max(0, currentSegment.start),
                    end: Math.min(totalDurationSec, currentSegment.end)
                });
            }
        } else { // mode === 'remove'
            let lastEndTime = 0;
            let mergedRemoveSegments = [];
            
            if (jsonSegments.length > 0) {
                let currentRemove = { ...jsonSegments[0] };
                for (let i = 1; i < jsonSegments.length; i++) {
                    const nextRemove = jsonSegments[i];
                    if (nextRemove.start <= currentRemove.end + 0.001) {
                        currentRemove.end = Math.max(currentRemove.end, nextRemove.end);
                    } else {
                        if (currentRemove.end > currentRemove.start) {
                            mergedRemoveSegments.push(currentRemove);
                        }
                        currentRemove = { ...nextRemove };
                    }
                }
                
                if (currentRemove.end > currentRemove.start) {
                    mergedRemoveSegments.push(currentRemove);
                }
            }
            
            for (const removeSegment of mergedRemoveSegments) {
                const removeStart = Math.max(0, removeSegment.start);
                const removeEnd = Math.min(totalDurationSec, removeSegment.end);
                
                if (removeStart < removeEnd) {
                    if (removeStart > lastEndTime + 0.001) {
                        keepSegments.push({ start: lastEndTime, end: removeStart });
                    }
                    lastEndTime = Math.max(lastEndTime, removeEnd);
                }
            }
            
            if (lastEndTime < totalDurationSec - 0.001) {
                keepSegments.push({ start: lastEndTime, end: totalDurationSec });
            }
        }
        
        return keepSegments.filter(seg => (seg.end - seg.start) > 0.001 && seg.start < totalDurationSec);
    }

    function createDownloadLink(data, filename, mimeType) {
        let blob;
        
        if (data instanceof Blob) {
            blob = data;
        } else if (data instanceof Uint8Array) {
            blob = new Blob([data.buffer], { type: mimeType });
        } else if (typeof data === 'string') {
            blob = new Blob([data], { type: mimeType });
        } else {
            console.error("Cannot create download link for data type:", typeof data);
            return;
        }
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.textContent = `Download ${filename}`;
        a.style.display = 'block';
        a.style.margin = '10px 0';
        a.style.padding = '10px';
        a.style.border = '1px solid #ccc';
        a.style.borderRadius = '4px';
        a.style.textDecoration = 'none';
        a.style.backgroundColor = '#eee';
        a.style.color = '#333';
        a.addEventListener('click', () => {
            setTimeout(() => URL.revokeObjectURL(url), 100);
        });
        
        downloadArea.appendChild(a);
    }

    function timeToSeconds(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return NaN;
        
        const parts = timeStr.split(':');
        let seconds = 0;
        const msSeparator = timeStr.includes(',') ? ',' : '.';
        
        try {
            if (parts.length === 3) {
                const secParts = parts[2].split(msSeparator);
                seconds += parseInt(parts[0], 10) * 3600;
                seconds += parseInt(parts[1], 10) * 60;
                seconds += parseInt(secParts[0], 10);
                if (secParts.length > 1) {
                    seconds += parseInt(secParts[1].padEnd(3, '0'), 10) / 1000;
                }
            } else if (parts.length === 2) {
                const secParts = parts[1].split(msSeparator);
                seconds += parseInt(parts[0], 10) * 60;
                seconds += parseInt(secParts[0], 10);
                if (secParts.length > 1) {
                    seconds += parseInt(secParts[1].padEnd(3, '0'), 10) / 1000;
                }
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

    function secondsToTime(totalSeconds, format = 'vtt') {
        if (isNaN(totalSeconds) || totalSeconds < 0) {
            return `00:00:00${format === 'vtt' ? '.' : ','}000`;
        }
        
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = Math.floor(totalSeconds % 60);
        const milliseconds = Math.round((totalSeconds % 1) * 1000);
        
        const sep = format === 'vtt' ? '.' : ',';
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${sep}${String(milliseconds).padStart(3, '0')}`;
    }

    function processSubtitles(subtitleText, type, keepSegments) {
        const lines = subtitleText.split(/\r?\n/);
        let outputLines = [];
        let cue = null;
        const timePattern = /(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\d{1,2}:\d{2}:\d{2}[.,]\d{3})/;
        
        if (type === 'vtt') {
            outputLines.push('WEBVTT');
            let i = 1;
            while(lines[i] && lines[i].trim() !== '' && !lines[i].match(timePattern)) {
                outputLines.push(lines[i]);
                i++;
            }
            outputLines.push('');
        }
        
        let parsingState = 'looking_for_cue_id_or_time';
        let cueHeaderLines = [];
        let cueTextLines = [];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();
            const timeMatch = trimmedLine.match(timePattern);
            
            if (parsingState === 'looking_for_cue_id_or_time') {
                if (trimmedLine === '') {
                    continue;
                } else if (timeMatch) {
                    parsingState = 'looking_for_text';
                    cue = {
                        originalStart: timeToSeconds(timeMatch[1]),
                        originalEnd: timeToSeconds(timeMatch[2]),
                        headerLines: cueHeaderLines,
                        timeLine: line
                    };
                    cueHeaderLines = [];
                    cueTextLines = [];
                } else {
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
                        timeLine: line
                    };
                    cueHeaderLines = [];
                    cueTextLines = [];
                } else if (trimmedLine === '') {
                    console.warn("Subtitle Parse Warning: Blank line after identifier before timecode near line:", i);
                    parsingState = 'looking_for_cue_id_or_time';
                    cueHeaderLines = [];
                } else {
                    cueHeaderLines.push(line);
                }
            } else if (parsingState === 'looking_for_text') {
                if (trimmedLine === '') {
                    if (cue) {
                        let { adjustedStart, adjustedEnd, belongs } = checkAndAdjustCueTime(
                            cue.originalStart, cue.originalEnd, keepSegments
                        );
                        
                        if (belongs && !isNaN(adjustedStart) && !isNaN(adjustedEnd)) {
                            const adjustedTimeLine = cue.timeLine.replace(
                                timePattern, 
                                `${secondsToTime(adjustedStart, type)} --> ${secondsToTime(adjustedEnd, type)}`
                            );
                            outputLines.push(...cue.headerLines);
                            outputLines.push(adjustedTimeLine);
                            outputLines.push(...cueTextLines);
                            outputLines.push('');
                        }
                        cue = null;
                    }
                    
                    parsingState = 'looking_for_cue_id_or_time';
                    cueHeaderLines = [];
                    cueTextLines = [];
                } else {
                    cueTextLines.push(line);
                }
            }
        }
        
        // Handle the last cue if we're still in the looking_for_text state
        if (parsingState === 'looking_for_text' && cue && cueTextLines.length > 0) {
            let { adjustedStart, adjustedEnd, belongs } = checkAndAdjustCueTime(
                cue.originalStart, cue.originalEnd, keepSegments
            );
            
            if (belongs && !isNaN(adjustedStart) && !isNaN(adjustedEnd)) {
                const adjustedTimeLine = cue.timeLine.replace(
                    timePattern, 
                    `${secondsToTime(adjustedStart, type)} --> ${secondsToTime(adjustedEnd, type)}`
                );
                outputLines.push(...cue.headerLines);
                outputLines.push(adjustedTimeLine);
                outputLines.push(...cueTextLines);
            }
        }
        
        return outputLines.join('\n');
    }

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
            if (segmentDuration <= 0) continue;
            
            const overlapStart = Math.max(originalStart, segment.start);
            const overlapEnd = Math.min(originalEnd, segment.end);
            
            if (overlapStart < overlapEnd) {
                belongs = true;
                const startWithinSegment = overlapStart - segment.start;
                const endWithinSegment = overlapEnd - segment.start;
                
                if (firstOverlap) {
                    adjustedStart = cumulativeDurationBefore + startWithinSegment;
                    firstOverlap = false;
                }
                
                adjustedEnd = cumulativeDurationBefore + endWithinSegment;
            }
            
            cumulativeDurationBefore += segmentDuration;
        }
        
        if (belongs) {
            if (adjustedEnd <= adjustedStart) {
                adjustedEnd = adjustedStart + 0.001;
                console.warn(`Adjusted cue end time <= start time. Setting minimal duration. Orig: ${originalStart}-${originalEnd}, Adj: ${adjustedStart}-${adjustedEnd}`);
            }
        } else {
            adjustedStart = NaN;
            adjustedEnd = NaN;
        }
        
        return { originalStart, originalEnd, adjustedStart, adjustedEnd, belongs };
    }

    // --- Initial Setup ---
    updateButtonState();
    loadFFmpeg();
}
