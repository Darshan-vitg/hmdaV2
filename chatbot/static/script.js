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

  /* ---------- send-button state ---------- */
  function updateSendButton(){
    const message = messageInput.value.trim();
    const files   = imageInput.files;
    const disabled = !message && files.length === 0;
    sendButton.classList.toggle("disabled", disabled);
    if(disabled){
      sendButton.setAttribute("data-disabled","true");
      sendButton.title = "Please enter a message or select an image";
    }else{
      sendButton.removeAttribute("data-disabled");
      sendButton.title = "";
    }
  }
  messageInput.addEventListener("input",updateSendButton);
  imageInput  .addEventListener("change",updateSendButton);
  updateSendButton();

  /* ---------- block empty submits ---------- */
  sendButton.addEventListener("click",e=>{
    if(sendButton.dataset.disabled) {
      e.preventDefault();
      showTemporaryError("Please enter a message or select an image",5000);
    }
  });

  /* ---------- form submit ---------- */
  form.addEventListener("submit",e=>{
    e.preventDefault();
    const message = messageInput.value.trim();
    const files   = imageInput.files;

    if(!message && files.length===0){
      showTemporaryError("Please enter a message or select an image",5000);
      return;
    }

    if(message){ appendChat("user",escapeHTML(message)); }

    const typingIndicator = showTypingIndicator();   /* spinner */

    const formData = new FormData(form);
    formData.set("prompt_id",currentPromptId);

    fetch("/handle_prompt/",{method:"POST",body:formData})
      .then(res=>res.json())
      .then(data=>{
        removeTypingIndicator(typingIndicator);

        /* ----- images from server ----- */
        const urls = data.image_urls || (data.image_url ? [data.image_url] : []);
        urls.forEach(raw=>{
          if(typeof raw!=="string" || !raw.trim()) return;
          let url = raw.trim();
          if(url.startsWith("s3://")){
            const parts = url.replace("s3://","").split("/");
            const bucket = parts.shift();
            url = `https://${bucket}.s3.amazonaws.com/${parts.join("/")}`;
          }
          appendUserImage(`<img src="${url}" alt="User uploaded image">`);
        });

        /* ----- bot response ----- */
        if(data.response){ appendChat("bot",data.response); }

        /* ----- optional map ----- */
        if(data.coordinates?.length){ appendBotMapButton(data.coordinates); }
      })
      .catch(err=>{
        removeTypingIndicator(typingIndicator);
        appendChat("bot",`<p style="color:red;">Error: ${escapeHTML(err.message)}</p>`);
      });

    form.reset();
    updateSendButton();
  });

  /* ========================================================
     UTILITIES
     ========================================================*/

  function showTypingIndicator(){
    const bubble = document.createElement("div");
    bubble.className = "chat-message typing";
    const typedSpan = document.createElement("span");
    typedSpan.id = "typed";
    bubble.appendChild(typedSpan);
    chatBox.appendChild(bubble);
    chatBox.scrollTop = chatBox.scrollHeight;

    new Typed("#typed",{
      strings:["Analyzing…","Thinking…","Working on it…"],
      typeSpeed:50,backSpeed:30,backDelay:1500,loop:true,
      smartBackspace:true
    });
    return bubble;
  }
  function removeTypingIndicator(el){ el?.remove(); }

  function showTemporaryError(text,duration=5000){
    const err = document.createElement("div");
    err.className = "chat-message error";
    err.textContent = text;
    chatBox.appendChild(err);
    chatBox.scrollTop = chatBox.scrollHeight;
    setTimeout(()=>err.remove(),duration);
  }

  /* ---------- prompt tabs ---------- */
  newPromptBtn.addEventListener("click",()=>{
    currentPromptId = createNewPrompt();
    chatBox.innerHTML = "";
  });

  function createNewPrompt(){
    const id = uuidv4();
    const li = document.createElement("li");
    li.textContent = `Prompt ${Object.keys(prompts).length+1}`;
    li.onclick = ()=>{ currentPromptId=id; chatBox.innerHTML = prompts[id]||""; };
    promptList.appendChild(li);
    prompts[id] = "";
    promptIdInput.value = id;
    return id;
  }

  /* ---------- chat helpers ---------- */
  function appendChat(role,html){
    const line   = document.createElement("div");
    line.className = `chat-line ${role}`;
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${role}`;
    bubble.innerHTML = role==="user" && !html.trim().startsWith("<img")
                      ? escapeHTML(html)
                      : html.replace(/\n/g,"<br>");
    line.appendChild(bubble);
    chatBox.appendChild(line);
    chatBox.scrollTop = chatBox.scrollHeight;
    prompts[currentPromptId] = (prompts[currentPromptId]||"") + line.outerHTML;
  }

  function appendUserImage(imgHTML){
    const line = document.createElement("div");
    line.className = "chat-line user";
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble user transparent";

    const container = document.createElement("div");
    container.className = "user-image-container";
    const wrapper   = document.createElement("div");
    wrapper.className = "user-image-wrapper";
    wrapper.innerHTML = imgHTML;
    container.appendChild(wrapper);

    container.addEventListener("click",()=>container.classList.toggle("expanded"));
    bubble.appendChild(container);
    line.appendChild(bubble);
    chatBox.appendChild(line);
    chatBox.scrollTop = chatBox.scrollHeight;
    prompts[currentPromptId] = (prompts[currentPromptId]||"") + line.outerHTML;
  }

  /* ---------- map helpers ---------- */
  function appendBotMapButton(coords){
    const bubble = document.createElement("div");
    bubble.className = "chat-message bot";
    bubble.innerHTML = `<p class="map-header">Lake Map</p>
                      <button class="show-map-btn">Show Map</button>
                      <button class="download-csv-btn">Download CSV</button>`;
    chatBox.appendChild(bubble);
    chatBox.scrollTop = chatBox.scrollHeight;
    prompts[currentPromptId] += bubble.outerHTML;

    const btn = bubble.querySelector(".show-map-btn");
    const csvBtn = bubble.querySelector(".download-csv-btn");
    let mapContainer = null;

    // Show/Hide map logic
    btn.addEventListener("click",()=>{
      if(!mapContainer){
        mapContainer   = createMapWithCoordinates(coords);
        bubble.appendChild(mapContainer);
        btn.textContent = "Hide Map";
      }else{
        mapContainer.remove();
        mapContainer = null;
        btn.textContent = "Show Map";
      }
      chatBox.scrollTop = chatBox.scrollHeight;
    });

    // CSV download logic
    csvBtn.addEventListener("click", () => {
      if (coords && coords.length > 0) {
        const csvContent = "Latitude,Longitude\n" + coords.flatMap(lake => {
          if (lake.coordinates) {
            return lake.coordinates.map(c => `${c.lat},${c.lon}`);
          }
          return `${lake.lat},${lake.lon}`;
        }).join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.setAttribute("href", URL.createObjectURL(blob));
        link.setAttribute("download", "coordinates.csv");
        link.click();
      }
    });
  }

  function createMapWithCoordinates(coords){
    const container = document.createElement("div");
    container.className = "chat-map-container";

    const btn = document.createElement("button");
    btn.className = "map-maximize-btn";
    btn.innerHTML = `<img src="/static/max.png" alt="Maximize">`;
    container.appendChild(btn);

    // Determine if multiple lakes
    const isMultiLake = Array.isArray(coords) && coords.length>0 && coords[0].coordinates && Array.isArray(coords[0].coordinates);
    // Gather all points for centering
    let allPoints = [];
    if(isMultiLake){
      coords.forEach(lake => {
        lake.coordinates.forEach(c => {
          if(typeof c.lat==="number" && typeof c.lon==="number") allPoints.push(c);
        });
      });
    } else {
      allPoints = coords.filter(c=>c && typeof c.lat==="number" && typeof c.lon==="number");
    }
    if(!allPoints.length){
      const ph = document.createElement("div");
      ph.textContent = "No valid coordinates to display.";
      return ph;
    }
    const centerLat = average(allPoints,"lat");
    const centerLon = average(allPoints,"lon");
    const map = L.map(container).setView([centerLat,centerLon],14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19}).addTo(map);

    const colors = ['red','green','blue','orange','purple','cyan','magenta','yellow','brown'];
    if(isMultiLake){
      coords.forEach((lake,i) => {
        const color = colors[i % colors.length];
        const lakePoints = lake.coordinates.filter(c=>typeof c.lat==="number"&&typeof c.lon==="number");
        const latlngs = lakePoints.map(c=>[c.lat,c.lon]);
        // Draw polyline for each lake
        L.polyline(latlngs,{color:color,weight:2.5}).addTo(map);
        // Add colored markers
        lakePoints.forEach((c,j) => {
          L.circleMarker([c.lat,c.lon],{radius:6,fillColor:color,color:color,weight:1,fillOpacity:0.8})
            .addTo(map)
            .bindPopup(`${lake.lake_name} - Point ${j+1}`);
        });
      });
    } else {
      const latlngs = allPoints.map(c=>[c.lat,c.lon]);
      L.polyline(latlngs,{color:'blue',weight:2.5}).addTo(map);
      allPoints.forEach((c,i) => {
        L.circleMarker([c.lat,c.lon],{radius:6,fillColor:'blue',color:'blue',weight:1,fillOpacity:0.8})
          .addTo(map)
          .bindPopup(`Point ${i+1}`);
      });
    }

    btn.addEventListener("click",()=>{
      const expanded = container.classList.toggle("expanded");
      btn.firstChild.src = expanded? "/static/min.png" : "/static/max.png";
      btn.firstChild.alt = expanded? "Minimize" : "Maximize";
      setTimeout(()=>map.invalidateSize(),300);
    });
    return container;
  }

  const average = (arr,key)=>arr.reduce((sum,c)=>sum+c[key],0)/arr.length;

  /* ---------- helpers ---------- */
  const escapeHTML = str=>str.replace(/&/g,"&amp;")
                             .replace(/</g,"&lt;")
                             .replace(/>/g,"&gt;");

  function uuidv4(){
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>
      (c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)
    );
  }

  /* ========================================================
     THEME TOGGLE
     ========================================================*/
  const toggleBtn = document.getElementById("theme-toggle");
  const saved     = localStorage.getItem("theme");
  if(saved==="light"){ document.body.classList.add("light-mode"); toggleBtn.textContent="☀️"; }

  toggleBtn.addEventListener("click",()=>{
    const light = document.body.classList.toggle("light-mode");
    toggleBtn.textContent = light ? "☀️" : "🌙";
    localStorage.setItem("theme",light?"light":"dark ");
  });

});
