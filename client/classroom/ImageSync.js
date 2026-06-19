export function setupImageSync({
  socket,
  role,
  presentationButton,
  appRoot,
}) {
  let presentationOverlay = null;
  let currentImages = [];
  let currentSlideIndex = 0;
  let laserButton = null;
  let laserDot = null;
  let laserHideTimer = null;
  let laserEnabled = false;
  let lastLaserSentAt = 0;
  let lastLaserPoint = null;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const networkType = String(connection?.effectiveType || "").toLowerCase();
  const isStrictLowBandwidth = Boolean(connection?.saveData) || networkType === "slow-2g" || networkType === "2g";
  const isLowBandwidth = Boolean(connection?.saveData) || isStrictLowBandwidth || networkType === "3g";
  const laserThrottleMs = isStrictLowBandwidth ? 220 : (isLowBandwidth ? 140 : 80);
  const laserMinDelta = isStrictLowBandwidth ? 10 : (isLowBandwidth ? 6 : 4);

  function syncLaserButtonState() {
    if (!laserButton) return;

    if (laserEnabled) {
      laserButton.textContent = isStrictLowBandwidth ? "Laser 2G" : "Laser On";
      laserButton.dataset.active = "true";
      laserButton.style.backgroundColor = "#f59e0b";
      laserButton.style.color = "#111827";
    } else {
      laserButton.textContent = "Laser";
      laserButton.dataset.active = "false";
      laserButton.style.backgroundColor = "rgba(241, 245, 249, 0.12)";
      laserButton.style.color = "#0f172a";
    }
  }

  function ensureLaserDot() {
    if (laserDot) return laserDot;

    laserDot = document.createElement("div");
    laserDot.id = "presentation-laser-dot";
    Object.assign(laserDot.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "18px",
      height: "18px",
      borderRadius: "999px",
      transform: "translate(-50%, -50%) scale(0)",
      opacity: "0",
      pointerEvents: "none",
      zIndex: "10005",
      background: "radial-gradient(circle, rgba(255,255,255,0.98) 0%, rgba(251,191,36,0.95) 35%, rgba(249,115,22,0.72) 72%, rgba(249,115,22,0.06) 100%)",
      boxShadow: "0 0 0 2px rgba(255,255,255,0.18), 0 0 18px rgba(249,115,22,0.75)",
      transition: "opacity 120ms ease, transform 120ms ease",
      willChange: "transform, opacity, left, top",
    });

    const host = document.getElementById("app") || document.body;
    host.appendChild(laserDot);
    return laserDot;
  }

  function hideLaser() {
    if (!laserDot) return;
    laserDot.style.opacity = "0";
    laserDot.style.transform = "translate(-50%, -50%) scale(0)";
  }

  function stopLaser() {
    laserEnabled = false;
    lastLaserPoint = null;
    if (laserHideTimer) {
      window.clearTimeout(laserHideTimer);
      laserHideTimer = null;
    }
    hideLaser();
    syncLaserButtonState();
    if (presentationOverlay) {
      presentationOverlay.style.cursor = "default";
    }
    if (role === "teacher") {
      socket.emit("blackboard-laser", { active: false });
    }
  }

  function applyLaserMode(enabled) {
    laserEnabled = Boolean(enabled);
    lastLaserPoint = null;
    if (laserHideTimer) {
      window.clearTimeout(laserHideTimer);
      laserHideTimer = null;
    }

    if (laserEnabled) {
      syncLaserButtonState();
      if (presentationOverlay) {
        presentationOverlay.style.cursor = "crosshair";
      }
      return;
    }

    hideLaser();
    syncLaserButtonState();
    if (presentationOverlay) {
      presentationOverlay.style.cursor = "default";
    }
    if (role === "teacher") {
      socket.emit("blackboard-laser", { active: false });
    }
  }

  function showLaser(clientX, clientY) {
    const dot = ensureLaserDot();
    dot.style.left = `${clientX}px`;
    dot.style.top = `${clientY}px`;
    dot.style.opacity = "1";
    dot.style.transform = "translate(-50%, -50%) scale(1)";

    if (laserHideTimer) {
      window.clearTimeout(laserHideTimer);
    }

    laserHideTimer = window.setTimeout(() => {
      hideLaser();
    }, 650);
  }

  function emitLaserPointer(event) {
    if (!laserEnabled || event.target?.closest?.(".presentation-controls")) return;

    const now = performance.now();
    const nextPoint = { x: Math.round(event.clientX), y: Math.round(event.clientY) };
    const tooSoon = now - lastLaserSentAt < laserThrottleMs;
    const movedLittle = lastLaserPoint
      ? Math.abs(nextPoint.x - lastLaserPoint.x) < laserMinDelta && Math.abs(nextPoint.y - lastLaserPoint.y) < laserMinDelta
      : false;

    if (tooSoon && movedLittle) return;

    lastLaserSentAt = now;
    lastLaserPoint = nextPoint;
    showLaser(nextPoint.x, nextPoint.y);
    socket.emit("blackboard-laser", {
      x: nextPoint.x,
      y: nextPoint.y,
      active: true,
    });
  }

  // UI for full-screen viewer
  function ensurePresentationOverlay() {
    if (presentationOverlay) return presentationOverlay;
    
    presentationOverlay = document.createElement("div");
    presentationOverlay.id = "presentation-overlay";
    Object.assign(presentationOverlay.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      backgroundColor: "#000",
      zIndex: "9999",
      display: "none",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      touchAction: "none",
    });

    const img = document.createElement("img");
    img.id = "presentation-image";
    Object.assign(img.style, {
      maxWidth: "100%",
      maxHeight: "90%",
      objectFit: "contain",
      transition: "opacity 0.3s ease-in-out",
      pointerEvents: "none",
    });

    presentationOverlay.appendChild(img);

    if (role === "teacher") {
      const controls = document.createElement("div");
      controls.className = "presentation-controls";
      Object.assign(controls.style, {
        position: "absolute",
        bottom: "20px",
        display: "flex",
        gap: "10px",
        backgroundColor: "var(--surface)",
        padding: "10px 20px",
        borderRadius: "8px",
        boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
        zIndex: "2",
      });

      const prevBtn = document.createElement("button");
      prevBtn.className = "dc-btn dc-btn-ghost";
      prevBtn.textContent = "Previous";
      prevBtn.onclick = () => {
        if (currentSlideIndex > 0) {
          updateSlide(currentSlideIndex - 1);
          broadcastSlide();
        }
      };

      const nextBtn = document.createElement("button");
      nextBtn.className = "dc-btn dc-btn-primary";
      nextBtn.textContent = "Next";
      nextBtn.onclick = () => {
        if (currentSlideIndex < currentImages.length - 1) {
          updateSlide(currentSlideIndex + 1);
          broadcastSlide();
        }
      };

      const micBtn = document.createElement("button");
      micBtn.className = "dc-btn dc-btn-secondary";
      micBtn.id = "presentation-mic-btn";

      const isMutedNow = () => {
        const voiceSystem = window.activeVoiceSystem;
        if (typeof voiceSystem?.isMuted === "boolean") {
          return voiceSystem.isMuted;
        }
        const mainMuteBtn = document.getElementById("mute-button");
        return mainMuteBtn ? mainMuteBtn.getAttribute("data-tooltip") === "Unmute Mic" : true;
      };
      
      const updateMicBtnState = () => {
        const isNowMuted = isMutedNow();
        micBtn.textContent = isNowMuted ? "Unmute Mic" : "Mute Mic";
        micBtn.style.backgroundColor = isNowMuted ? "" : "#16a34a";
        micBtn.style.color = isNowMuted ? "" : "#fff";
      };
      
      // Initial state
      setTimeout(updateMicBtnState, 0);

      micBtn.onclick = () => {
        const mainMuteBtn = document.getElementById("mute-button");
        if (mainMuteBtn) {
          // Reuse the primary button handler so icon, title, and track state stay in sync.
          mainMuteBtn.click();
        } else {
          const voiceSystem = window.activeVoiceSystem;
          if (voiceSystem?.toggleMute) {
            voiceSystem.toggleMute();
            voiceSystem.refreshRemoteAudioElements?.();
          }
        }
        updateMicBtnState();
      };

      laserButton = document.createElement("button");
      laserButton.className = "dc-btn dc-btn-secondary";
      laserButton.onclick = () => {
        window.dispatchEvent(new CustomEvent("dc-blackboard-laser-mode", {
          detail: { enabled: !laserEnabled },
        }));
      };
      syncLaserButtonState();

      const exitBtn = document.createElement("button");
      exitBtn.className = "dc-btn dc-btn-danger";
      exitBtn.textContent = "Stop Broadcast";
      exitBtn.onclick = () => {
        stopLaser();
        presentationOverlay.style.display = "none";
        socket.emit("presentation-stop");
      };

      controls.appendChild(prevBtn);
      controls.appendChild(nextBtn);
      controls.appendChild(micBtn);
      controls.appendChild(laserButton);
      controls.appendChild(exitBtn);
      presentationOverlay.appendChild(controls);

      presentationOverlay.addEventListener("pointermove", emitLaserPointer, { passive: true });
      presentationOverlay.addEventListener("pointerleave", stopLaser);
      presentationOverlay.addEventListener("pointercancel", stopLaser);
    }

    appRoot.appendChild(presentationOverlay);
    // Notify other UI that presentation overlay is now available
    window.dispatchEvent(new CustomEvent("dc-presentation-active", { detail: { active: true } }));
    return presentationOverlay;
  }

  function updateSlide(index) {
    if (!currentImages || currentImages.length === 0) return;
    currentSlideIndex = index;
    const imgEl = document.getElementById("presentation-image");
    if (imgEl && currentImages[index]) {
      imgEl.src = currentImages[index];
    }
  }

  function broadcastSlide() {
    socket.emit("presentation-update", { 
      index: currentSlideIndex, 
      image: currentImages[currentSlideIndex] // Only send the needed image on slide change
    });
  }

  // Socket Events
  socket.on("presentation-start", ({ image, index }) => {
    ensurePresentationOverlay();

    // Set the image on the student side without receiving the full array
    if (role === "student" && image) {
      if (!currentImages) currentImages = [];
      currentImages[index] = image;
    }

    presentationOverlay.style.display = "flex";
    updateSlide(index || 0);
  });

  socket.on("presentation-update", ({ index, image }) => {
    // If the student receives a new slide image dynamically
    if (role === "student" && image) {
      currentImages[index] = image;
    }
    updateSlide(index);
  });

  socket.on("presentation-stop", () => {
    stopLaser();
    if (presentationOverlay) {
      presentationOverlay.style.display = "none";
    }
    window.dispatchEvent(new CustomEvent("dc-presentation-active", { detail: { active: false } }));
  });

  socket.on("blackboard-laser", (payload = {}) => {
    if (!presentationOverlay || presentationOverlay.style.display !== "flex") {
      return;
    }

    const active = payload.active !== false;
    if (!active) {
      hideLaser();
      return;
    }

    const x = Number(payload.x);
    const y = Number(payload.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    showLaser(x, y);
  });

  const handleLaserModeChange = (event) => {
    if (role !== "teacher") return;
    const nextEnabled = Boolean(event?.detail?.enabled);
    if (nextEnabled === laserEnabled) {
      syncLaserButtonState();
      if (presentationOverlay) {
        presentationOverlay.style.cursor = laserEnabled ? "crosshair" : "default";
      }
      return;
    }

    applyLaserMode(nextEnabled);
  };
  window.addEventListener("dc-blackboard-laser-mode", handleLaserModeChange);

  // Teacher UI setup
  if (role === "teacher" && presentationButton) {
    // Create a hidden file input to let the teacher select slide images
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.multiple = true; // Allows selecting multiple pre-converted slide images
    fileInput.accept = "image/png, image/jpeg, image/webp, .ppt, .pptx, .pdf";
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);

    presentationButton.addEventListener("click", () => {
      fileInput.click();
    });

    fileInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files);
      if (!files.length) return;

      // Handle unsupported formats (PPT/PPTX)
      const hasPPT = files.some(f => f.name.endsWith(".ppt") || f.name.endsWith(".pptx"));
      if (hasPPT) {
        alert("For PowerPoint files (.ppt, .pptx), please 'Save as PDF', then upload the PDF file here. We will handle the rest!");
        fileInput.value = "";
        return;
      }

      let images = [];
      const originalSvg = presentationButton.innerHTML;

      // Handle PDF format client-side using pdf.js
      const pdfFile = files.find(f => f.name.endsWith(".pdf"));
      if (pdfFile) {
        try {
          presentationButton.innerHTML = `<span style="font-size:12px; font-weight:bold;">Processing PDF...</span>`;
          
          if (!window.pdfjsLib) {
            const script = document.createElement("script");
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
            document.head.appendChild(script);
            await new Promise((resolve, reject) => {
              script.onload = resolve;
              script.onerror = () => reject(new Error("Failed to load PDF library"));
            });
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
          }

          const arrayBuffer = await pdfFile.arrayBuffer();
          const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.5 }); // Good quality balance
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;
            images.push(canvas.toDataURL("image/jpeg", 0.7)); // Compress as JPEG
          }
        } catch (err) {
          console.error(err);
          alert("Could not process this PDF file. Try exporting it as images directly.");
          presentationButton.innerHTML = originalSvg;
          fileInput.value = "";
          return;
        } finally {
          presentationButton.innerHTML = originalSvg;
        }
      } else {
        // Sort image files alphabetically so Slide1, Slide2, Slide3 stay in order
        files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        // Read all selected image files into Data URLs (Base64)
        const readers = files.map(file => {
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.readAsDataURL(file);
          });
        });

        images = await Promise.all(readers);
      }

      currentImages = images;
      currentSlideIndex = 0;

      // Auto-unmute mic when sharing
      const voiceSystem = window.activeVoiceSystem;
      const mainMuteBtn = document.getElementById("mute-button");
      if (mainMuteBtn && mainMuteBtn.getAttribute("data-tooltip") === "Unmute Mic") {
        mainMuteBtn.click(); // trigger unmute through the main button flow
      } else if (voiceSystem?.ensureUnmuted) {
        voiceSystem.ensureUnmuted();
        voiceSystem.refreshRemoteAudioElements?.();
      }

      ensurePresentationOverlay().style.display = "flex";
      updateSlide(0);

      // Update mic button on overlay
      const micBtn = document.getElementById("presentation-mic-btn");
      const mainMuteBtnForOverlay = document.getElementById("mute-button");
      if (micBtn && mainMuteBtnForOverlay) {
        const isNowMuted = mainMuteBtnForOverlay.getAttribute("data-tooltip") === "Unmute Mic";
        micBtn.textContent = isNowMuted ? "Unmute Mic" : "Mute Mic";
        micBtn.style.backgroundColor = isNowMuted ? "" : "#16a34a";
        micBtn.style.color = isNowMuted ? "" : "#fff";
      }

      // Send JUST the current image to the students to save bandwidth initially
      socket.emit("presentation-start", { 
        image: currentImages[currentSlideIndex], 
        index: currentSlideIndex 
      });

      // Reset the input so that new files can be chosen later if needed
      fileInput.value = "";
    });
  }

}
