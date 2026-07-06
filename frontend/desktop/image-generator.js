if (new URLSearchParams(window.location.search).has("embedded")) {
  document.body.classList.add("embedded");
  if (!window.desktop && window.parent?.desktop) {
    window.desktop = window.parent.desktop;
  }
}

const IMAGE_PROVIDER_PRESETS = Object.freeze([
  Object.freeze({
    id: "volcengine",
    name: "火山方舟",
    shortName: "HS",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seedream-5-0-260128",
    description: "Doubao Seedream"
  }),
  Object.freeze({
    id: "custom",
    name: "自定义",
    shortName: "自",
    baseUrl: "",
    model: "",
    description: "兼容 /images/generations"
  })
]);

const state = {
  config: null,
  draft: null,
  status: "idle",
  generating: false,
  images: []
};

const elements = {
  providerGrid: document.querySelector("#providerGrid"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  modelInput: document.querySelector("#modelInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  promptInput: document.querySelector("#promptInput"),
  negativePromptInput: document.querySelector("#negativePromptInput"),
  sizeInput: document.querySelector("#sizeInput"),
  countInput: document.querySelector("#countInput"),
  responseFormatInput: document.querySelector("#responseFormatInput"),
  form: document.querySelector("#generatorForm"),
  saveConfigBtn: document.querySelector("#saveConfigBtn"),
  generateBtn: document.querySelector("#generateBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  openConfigBtn: document.querySelector("#openConfigBtn"),
  messageLine: document.querySelector("#messageLine"),
  statusPill: document.querySelector("#statusPill"),
  resultGrid: document.querySelector("#resultGrid"),
  template: document.querySelector("#imageTemplate")
};

function providerById(id) {
  return (
    IMAGE_PROVIDER_PRESETS.find((provider) => provider.id === id) ||
    IMAGE_PROVIDER_PRESETS[0]
  );
}

function renderProviderGrid() {
  elements.providerGrid.replaceChildren();
  IMAGE_PROVIDER_PRESETS.forEach((provider) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `provider-option${
      state.draft.providerId === provider.id ? " active" : ""
    }`;
    const logo = document.createElement("i");
    logo.textContent = provider.shortName;
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = provider.name;
    const description = document.createElement("small");
    description.textContent = provider.description;
    copy.append(name, description);
    button.append(logo, copy);
    button.addEventListener("click", () => {
      const changed = state.draft.providerId !== provider.id;
      state.draft.providerId = provider.id;
      state.draft.providerName = provider.name;
      if (changed) {
        state.draft.apiKey = "";
        state.draft.hasApiKey = false;
      }
      if (provider.id !== "custom") {
        state.draft.baseUrl = provider.baseUrl;
        state.draft.model = provider.model;
      }
      syncDraftInputs();
      renderProviderGrid();
      renderStatus();
    });
    elements.providerGrid.append(button);
  });
}

function syncDraftInputs() {
  elements.baseUrlInput.value = state.draft.baseUrl || "";
  elements.modelInput.value = state.draft.model || "";
  elements.apiKeyInput.value = "";
  elements.apiKeyInput.placeholder = state.draft.hasApiKey
    ? "已保存，留空保持不变"
    : "Ark API Key";
}

function collectDraft() {
  return {
    ...state.draft,
    baseUrl: elements.baseUrlInput.value.trim(),
    model: elements.modelInput.value.trim(),
    apiKey: elements.apiKeyInput.value.trim()
  };
}

function validateConfig(config) {
  if (!config.baseUrl) return "请填写 API 端点";
  if (!/^https?:\/\//i.test(config.baseUrl)) return "API 端点需要以 http:// 或 https:// 开头";
  if (!config.model) return "请填写图像生成模型";
  if (!config.apiKey && !config.hasApiKey) return "请填写 API Key";
  return "";
}

function validateGeneration() {
  if (!elements.promptInput.value.trim()) return "请填写提示词";
  return "";
}

function setMessage(type, text) {
  elements.messageLine.className = `message-line ${type || ""}`;
  elements.messageLine.textContent = text || "";
}

function renderStatus() {
  const labels = {
    idle: state.config?.hasApiKey ? "已配置" : "待配置",
    success: "已连接",
    error: "异常",
    running: "生成中"
  };
  elements.statusPill.className = `status-pill ${state.status}`;
  elements.statusPill.querySelector("b").textContent = labels[state.status] || labels.idle;
  elements.generateBtn.disabled = state.generating;
  elements.generateBtn.textContent = state.generating ? "生成中..." : "生成图片";
}

async function saveConfig() {
  const draft = collectDraft();
  const validationError = validateConfig(draft);
  if (validationError) {
    state.status = "error";
    setMessage("error", validationError);
    renderStatus();
    return null;
  }
  try {
    state.config = await window.desktop.saveAIImageConfig(draft);
    state.draft = { ...state.config, apiKey: "" };
    state.status = "success";
    syncDraftInputs();
    renderProviderGrid();
    renderStatus();
    setMessage("success", "图像生成配置已保存");
    return state.config;
  } catch (error) {
    state.status = "error";
    renderStatus();
    setMessage("error", error.message || "保存配置失败");
    return null;
  }
}

function generationPayload(draft) {
  return {
    ...draft,
    prompt: elements.promptInput.value.trim(),
    negativePrompt: elements.negativePromptInput.value.trim(),
    size: elements.sizeInput.value,
    n: Number(elements.countInput.value),
    responseFormat: elements.responseFormatInput.value,
    watermark: false
  };
}

function normalizeImages(result) {
  if (Array.isArray(result?.images) && result.images.length) return result.images;
  const candidates = Array.isArray(result?.data?.data)
    ? result.data.data
    : Array.isArray(result?.data?.images)
      ? result.data.images
      : [];
  return candidates
    .map((item) => ({
      url: String(item?.url || item?.image_url || item?.imageUrl || ""),
      b64Json: String(item?.b64_json || item?.b64Json || item?.base64 || ""),
      revisedPrompt: String(item?.revised_prompt || item?.revisedPrompt || "")
    }))
    .filter((item) => item.url || item.b64Json);
}

function imageSource(image) {
  if (image.url) return image.url;
  if (!image.b64Json) return "";
  if (image.b64Json.startsWith("data:")) return image.b64Json;
  return `data:image/png;base64,${image.b64Json}`;
}

function renderImages() {
  elements.resultGrid.replaceChildren();
  if (!state.images.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<i>图</i><strong>等待生成</strong>";
    elements.resultGrid.append(empty);
    return;
  }
  state.images.forEach((image, index) => {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    const source = imageSource(image);
    const img = card.querySelector("img");
    const label = card.querySelector("span");
    const link = card.querySelector("a");
    img.src = source;
    label.textContent = image.revisedPrompt || `生成结果 ${index + 1}`;
    link.href = source;
    link.download = `aetherx-image-${Date.now()}-${index + 1}.png`;
    elements.resultGrid.append(card);
  });
}

async function generateImage(event) {
  event.preventDefault();
  const validationError = validateGeneration();
  if (validationError) {
    setMessage("error", validationError);
    return;
  }
  const draft = collectDraft();
  const configError = validateConfig(draft);
  if (configError) {
    state.status = "error";
    setMessage("error", configError);
    renderStatus();
    return;
  }

  state.generating = true;
  state.status = "running";
  setMessage("", "正在请求图像生成模型...");
  renderStatus();
  try {
    await window.desktop.saveAIImageConfig(draft);
    const result = await window.desktop.generateImage(generationPayload(draft));
    if (!result?.ok) {
      throw new Error(
        result?.data?.error?.message ||
          result?.data?.message ||
          `生成失败，HTTP ${result?.status || "未知"}`
      );
    }
    const images = normalizeImages(result);
    if (!images.length) throw new Error("模型已响应，但没有返回可展示的图片");
    state.images = images;
    state.config = await window.desktop.getAIImageConfig();
    state.draft = { ...state.config, apiKey: "" };
    state.status = "success";
    syncDraftInputs();
    renderProviderGrid();
    renderImages();
    setMessage("success", `已生成 ${images.length} 张图片`);
  } catch (error) {
    state.status = "error";
    setMessage("error", error.message || "图像生成失败");
  } finally {
    state.generating = false;
    renderStatus();
  }
}

async function initialize() {
  state.config = await window.desktop.getAIImageConfig();
  state.draft = { ...state.config, apiKey: "" };
  renderProviderGrid();
  syncDraftInputs();
  renderStatus();
  renderImages();
}

document.querySelector("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
document.querySelector("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
document.querySelector("#closeBtn").addEventListener("click", () => window.desktop.close());
elements.saveConfigBtn.addEventListener("click", saveConfig);
elements.form.addEventListener("submit", generateImage);
elements.clearBtn.addEventListener("click", () => {
  elements.promptInput.value = "";
  elements.negativePromptInput.value = "";
  setMessage("", "");
});
elements.openConfigBtn.addEventListener("click", () => {
  const provider = providerById("volcengine");
  state.draft.providerId = provider.id;
  state.draft.providerName = provider.name;
  state.draft.baseUrl = provider.baseUrl;
  state.draft.model = provider.model;
  syncDraftInputs();
  renderProviderGrid();
});

initialize().catch((error) => {
  state.status = "error";
  renderStatus();
  setMessage("error", error.message || "图像生成初始化失败");
});
