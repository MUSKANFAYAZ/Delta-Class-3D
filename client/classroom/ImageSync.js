export function setupImageSync({
  socket,
  role,
  presentationButton,
  appRoot,
}) {
  let presentationOverlay = null;
  let currentImages = [];
  let currentSlideIndex = 0;

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
    });

    const img = document.createElement("img");
    img.id = "presentation-image";
    Object.assign(img.style, {
      maxWidth: "100%",
      maxHeight: "90%",
      objectFit: "contain",
      transition: "opacity 0.3s ease-in-out",
    });

    presentationOverlay.appendChild(img);

    if (role === "teacher") {
      const controls = document.createElement("div");
      Object.assign(controls.style, {
        position: "absolute",
        bottom: "20px",
        display: "flex",
        gap: "10px",
        backgroundColor: "var(--surface)",
        padding: "10px 20px",
        borderRadius: "8px",
        boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
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
      
      const updateMicBtnState = () => {
        const mainMuteBtn = document.getElementById("mute-button");
        if (mainMuteBtn) {
          const isNowMuted = mainMuteBtn.title === "Unmute Mic";
          micBtn.textContent = isNowMuted ? "Unmute Mic" : "Mute Mic";
          micBtn.style.backgroundColor = isNowMuted ? "" : "#16a34a";
          micBtn.style.color = isNowMuted ? "" : "#fff";
        }
      };
      
      // Initial state
      setTimeout(updateMicBtnState, 0);

      micBtn.onclick = () => {
        const mainMuteBtn = document.getElementById("mute-button");
        if (mainMuteBtn) {
          mainMuteBtn.click();
          updateMicBtnState();
        }
      };

      const exitBtn = document.createElement("button");
      exitBtn.className = "dc-btn dc-btn-danger";
      exitBtn.textContent = "Stop Broadcast";
      exitBtn.onclick = () => {
        presentationOverlay.style.display = "none";
        socket.emit("presentation-stop");
      };

      controls.appendChild(prevBtn);
      controls.appendChild(nextBtn);
      controls.appendChild(micBtn);
      controls.appendChild(exitBtn);
      presentationOverlay.appendChild(controls);
    }

    appRoot.appendChild(presentationOverlay);
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
    if (presentationOverlay) {
      presentationOverlay.style.display = "none";
    }
  });

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
      const mainMuteBtn = document.getElementById("mute-button");
      if (mainMuteBtn && mainMuteBtn.title === "Unmute Mic") {
        mainMuteBtn.click(); // trigger unmute
      }

      ensurePresentationOverlay().style.display = "flex";
      updateSlide(0);

      // Update mic button on overlay
      const micBtn = document.getElementById("presentation-mic-btn");
      if (micBtn && mainMuteBtn) {
        const isNowMuted = mainMuteBtn.title === "Unmute Mic";
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
