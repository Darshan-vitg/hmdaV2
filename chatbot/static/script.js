document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("chat-form");
    const chatBox = document.getElementById("chat-box");
    const promptIdInput = document.getElementById("prompt_id");
    const promptList = document.getElementById("prompt-list");
    const newPromptBtn = document.getElementById("new-prompt");

    const prompts = {};
    let currentPromptId = createNewPrompt();

    form.addEventListener("submit", function (e) {
        e.preventDefault();

        const formData = new FormData(form);
        const message = formData.get("message");
        if (!currentPromptId) return;

        formData.set("prompt_id", currentPromptId);

        if (message) appendMessage("user", message);

        fetch("/handle_prompt/", {
            method: "POST",
            body: formData
        })
            .then(res => res.json())
            .then(data => {
                const reply = data.response || data.message || JSON.stringify(data);
                appendMessage("bot", reply);
            })
            .catch(err => appendMessage("bot", "Error: " + err.message));

        form.reset();
    });

    newPromptBtn.addEventListener("click", () => {
        currentPromptId = createNewPrompt();
        chatBox.innerHTML = '';
    });

    function createNewPrompt() {
        const id = uuidv4();
        const li = document.createElement("li");
        li.textContent = `Prompt ${Object.keys(prompts).length + 1}`;
        li.onclick = () => {
            currentPromptId = id;
            chatBox.innerHTML = prompts[id] || '';
        };
        promptList.appendChild(li);
        prompts[id] = '';
        promptIdInput.value = id;
        return id;
    }

    function appendMessage(role, text) {
        const div = document.createElement("div");
        div.className = `chat-message ${role}`;
        div.textContent = text;
        chatBox.appendChild(div);
        chatBox.scrollTop = chatBox.scrollHeight;
        prompts[currentPromptId] += div.outerHTML;
    }

    function uuidv4() {
        return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }
});