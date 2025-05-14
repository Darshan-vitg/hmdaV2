// scrpit.js

document.addEventListener("DOMContentLoaded", () => {
  /* ---------- element refs ---------- */
  const form          = document.getElementById("chat-form");
  const chatBox       = document.getElementById("chat-box");
  const promptIdInput = document.getElementById("prompt_id");
  const promptList    = document.getElementById("prompt-list");
  const newPromptBtn  = document.getElementById("new-prompt");
  const messageInput  = document.getElementById("message");
  const imageInput    = document.getElementById("image");
  const sendButton    = document.querySelector(".send-btn");

  /* ---------- prompt storage ---------- */
  const prompts = {};
  let currentPromptId = createNewPrompt();

  /* ---------- marker icons for each lake ---------- */
  const iconBase = 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/';
  const colors = ['red', 'green', 'blue', 'orange', 'purple', 'cyan', 'magenta', 'yellow', 'brown'];
  const markerIcons = colors.reduce((acc, color) => {
    acc[color] = L.icon({
      iconUrl: `${iconBase}marker-icon-${color}.png`,
      shadowUrl: `${iconBase}marker-shadow.png`,
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });
    return acc;
  }, {});

  /* ---------- send-button state ---------- */
  function updateSendButton() {
    const message = messageInput.value.trim();
    const files   = imageInput.files;
    const disabled = !message && files.length === 0;
    sendButton.classList.toggle("disabled", disabled);
    if (disabled) {
      sendButton.setAttribute("data-disabled", "true");
      sendButton.title = "Please enter a message or select an image";
    } else {
      sendButton.removeAttribute("data-disabled");
      sendButton.title = "";
    }
  }
  messageInput.addEventListener("input", updateSendButton);
  imageInput.addEventListener("change", updateSendButton);
  updateSendButton();

  /* ---------- block empty submits ---------- */
  sendButton.addEventListener("click", e => {
    if (sendButton.dataset.disabled) {
      e.preventDefault();
      showTemporaryError("Please enter a message or select an image", 5000);
    }
  });

  /* ---------- form submit ---------- */
  form.addEventListener("submit", e => {
    e.preventDefault();
    const message = messageInput.value.trim();
    const files   = imageInput.files;
    const sameLakeCheckbox   = document.getElementById("is_same_lake");
    // save its current state:
    const lastSameLakeState  = sameLakeCheckbox.checked;
    if (!message && files.length === 0) {
      showTemporaryError("Please enter a message or select an image", 5000);
      return;
    }
    if (message) appendChat("user", escapeHTML(message));
    const indicator = showTypingIndicator();

    const formData = new FormData(form);
    formData.set("prompt_id", currentPromptId);

    fetch("/handle_prompt/", { method: "POST", body: formData })
      .then(res => {
        if (!res.ok) {
          // pull out the raw text so you can see the HTML error
          return res.text().then(text => { throw new Error(text); });
        }
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          // again, grab the raw text so you know what’s coming back
          return res.text().then(text => {
            throw new Error(`Expected JSON, got ${ct}: ${text}`);
          });
        }
        return res.json();
      })
      .then(data => {
        removeTypingIndicator(indicator);

        // display returned images
        const urls = data.image_urls || (data.image_url ? [data.image_url] : []);
        urls.forEach(raw => {
          if (typeof raw !== "string" || !raw.trim()) return;
          let url = raw.trim();
          if (url.startsWith("s3://")) {
            const parts = url.replace("s3://", "").split("/");
            url = `https://${parts.shift()}.s3.amazonaws.com/${parts.join("/")}`;
          }
          appendUserImage(`<img src="${url}" alt="User uploaded image">`);
        });

        // bot text
        if (data.response) appendChat("bot", data.response);

        // optional map button
        if (data.coordinates?.length) appendBotMapButton(data.coordinates);
      })
      .catch(err => {
        removeTypingIndicator(indicator);
        const isHTML = err.message.trim().startsWith("<");
        const message = isHTML
          ? `Server returned HTML:\n${escapeHTML(err.message)}`
          : err.message;
        appendChat("bot", `<p style="color:red;">Error: ${escapeHTML(err.message)}</p>`);
      });

    form.reset();
    sameLakeCheckbox.checked = lastSameLakeState;
    updateSendButton();
  });

  /* ========================================================
     MAP WIDGET
     ======================================================== */
  function appendBotMapButton(coords) {
    const bubble = document.createElement("div");
    bubble.className = "chat-message bot";
    bubble.innerHTML = `
      <p class="map-header">Lake Map</p>
      <button class="show-map-btn">Show Map</button>
      <button class="download-csv-btn">Download CSV</button>
    `;
    chatBox.appendChild(bubble);
    chatBox.scrollTop = chatBox.scrollHeight;

    const btn    = bubble.querySelector(".show-map-btn");
    const csvBtn = bubble.querySelector(".download-csv-btn");
    let mapContainer = null;

    btn.addEventListener("click", () => {
      if (!mapContainer) {
        mapContainer = createMapWithCoordinates(coords);
        bubble.appendChild(mapContainer);
        btn.textContent = "Hide Map";
        // ensure map displays properly and center
        setTimeout(() => {
          mapContainer.leafletMap.invalidateSize();
          bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 100);
      } else {
        mapContainer.remove();
        mapContainer = null;
        btn.textContent = "Show Map";
      }
    });

    csvBtn.addEventListener("click", () => {
      if (coords?.length) {
        const lines = ["Latitude,Longitude"];
        coords.forEach(lake => {
          if (lake.coordinates) {
            lake.coordinates.forEach(c => lines.push(`${c.lat},${c.lon}`));
          } else {
            lines.push(`${lake.lat},${lake.lon}`);
          }
        });
        const blob = new Blob([lines.join("\n")], { type: 'text/csv' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "coordinates.csv";
        link.click();
      }
    });
  }

  function createMapWithCoordinates(coords) {
    const container = document.createElement("div");
    container.className = "chat-map-container";

    const btn = document.createElement("button");
    btn.className = "map-maximize-btn";
    btn.innerHTML = `<img src="/static/max.png" alt="Maximize">`;
    container.appendChild(btn);

    const isMultiLake = Array.isArray(coords) && coords[0]?.coordinates;
    const allPoints = isMultiLake ? coords.flatMap(lake => lake.coordinates) : coords;

    const avg = arr => arr.reduce((sum, v) => sum + v, 0) / arr.length;
    const centerLat = avg(allPoints.map(c => c.lat));
    const centerLon = avg(allPoints.map(c => c.lon));

    const map = L.map(container).setView([centerLat, centerLon], 13);
    container.leafletMap = map;  // expose for invalidation
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

    if (isMultiLake) {
      coords.forEach((lake, i) => {
        const color = colors[i % colors.length];
        const latlngs = lake.coordinates.map(c => [c.lat, c.lon]);
        L.polyline(latlngs, { color, weight: 2.5 }).addTo(map);
        lake.coordinates.forEach((c, j) => {
          L.marker([c.lat, c.lon], { icon: markerIcons[color] })
           .addTo(map)
           .bindPopup(`${lake.lake_name} – Point ${j+1}`);
        });
      });
    } else {
      const latlngs = allPoints.map(c => [c.lat, c.lon]);
      L.polyline(latlngs, { color: 'blue', weight: 2.5 }).addTo(map);
      allPoints.forEach((c, i) => {
        L.marker([c.lat, c.lon], { icon: markerIcons['blue'] })
         .addTo(map)
         .bindPopup(`Point ${i+1}`);
      });
    }

    btn.addEventListener("click", () => {
      const expanded = container.classList.toggle("expanded");
      btn.firstChild.src = expanded ? "/static/min.png" : "/static/max.png";
      btn.firstChild.alt = expanded ? "Minimize" : "Maximize";
      setTimeout(() => {
        map.invalidateSize();
        container.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 300);
    });

    return container;
  }

  /* ========================================================
     OTHER HELPERS
     ======================================================== */
  function showTypingIndicator() {
    const bubble = document.createElement("div");
    bubble.className = "chat-message typing";
    const span = document.createElement("span");
    span.id = "typed";
    bubble.appendChild(span);
    chatBox.appendChild(bubble);
    new Typed("#typed", {
      strings: ["Analyzing…", "Thinking…"],
      typeSpeed: 50,
      backSpeed: 30,
      backDelay: 1500,
      loop: true
    });
    return bubble;
  }
  function removeTypingIndicator(el) { el.remove(); }
  function showTemporaryError(t, d = 5000) {
    const err = document.createElement("div");
    err.className = "chat-message error";
    err.textContent = t;
    chatBox.appendChild(err);
    setTimeout(() => err.remove(), d);
  }
  function createNewPrompt() {
    const id = uuidv4();
    const li = document.createElement("li");
    li.textContent = `Prompt ${Object.keys(prompts).length + 1}`;
    li.onclick = () => {
      currentPromptId = id;
      chatBox.innerHTML = prompts[id] || "";
    };
    promptList.appendChild(li);
    prompts[id] = "";
    promptIdInput.value = id;
    return id;
  }
  function appendChat(role, html) {
    const line = document.createElement("div");
    line.className = `chat-line ${role}`;
    const b = document.createElement("div");
    b.className = `chat-bubble ${role}`;
    b.innerHTML = role === "user" && !html.trim().startsWith("<img>")
      ? escapeHTML(html)
      : html.replace(/\n/g, "<br>");
    line.appendChild(b);
    chatBox.appendChild(line);
    chatBox.scrollTop = chatBox.scrollHeight;
    prompts[currentPromptId] = (prompts[currentPromptId] || "") + line.outerHTML;
  }
  function appendUserImage(h) {
    const line = document.createElement("div");
    line.className = "chat-line user";
    const b = document.createElement("div");
    b.className = "chat-bubble user transparent";
    const c = document.createElement("div");
    c.className = "user-image-container";
    const w = document.createElement("div");
    w.className = "user-image-wrapper";
    w.innerHTML = h;
    c.appendChild(w);
    c.addEventListener("click", () => c.classList.toggle("expanded"));
    b.appendChild(c);
    line.appendChild(b);
    chatBox.appendChild(line);
    chatBox.scrollTop = chatBox.scrollHeight;
    prompts[currentPromptId] = (prompts[currentPromptId] || "") + line.outerHTML;
  }
  function escapeHTML(s) {
    return s.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
  }
  function uuidv4() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11)
      .replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c/4))).toString(16)
      );
  }

  /* ========================================================
     THEME TOGGLE
     ======================================================== */
  const toggleBtn = document.getElementById("theme-toggle");
  const saved     = localStorage.getItem("theme");
  if (saved === "light") {
    document.body.classList.add("light-mode");
    toggleBtn.textContent = "☀️";
  }
  toggleBtn.addEventListener("click", () => {
    const light = document.body.classList.toggle("light-mode");
    toggleBtn.textContent = light ? "☀️" : "🌙";
    localStorage.setItem("theme", light ? "light" : "dark");
  });
});
