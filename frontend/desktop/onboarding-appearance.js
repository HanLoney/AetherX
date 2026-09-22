(function (global) {
  const DEFAULT_IMAGE = "463029ca-445d-4f33-8ce3-9ff0ad89a5f8.png";
  const $ = (selector) => document.querySelector(selector);
  let cropper;
  let busy = false;
  let candidate = "";
  let options;
  function message(type, text) {
    $("#appearanceResult").className = `result ${type}`;
    $("#appearanceResult").textContent = text;
  }
  async function raster(source, avatar = false) {
    const image = new Image();
    if (/^https?:/.test(source)) image.crossOrigin = "anonymous";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("无法读取图片，请下载后重新上传。"));
      image.src = source;
    });
    const canvas = document.createElement("canvas");
    if (avatar) {
      canvas.width = canvas.height = 512;
      const size = Math.min(image.naturalWidth, image.naturalHeight);
      canvas.getContext("2d").drawImage(image, (image.naturalWidth - size) / 2, 0, size, size, 0, 0, 512, 512);
    } else {
      const ratio = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.round(image.naturalWidth * ratio);
      canvas.height = Math.round(image.naturalHeight * ratio);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    }
    const result = canvas.toDataURL("image/webp", 0.88);
    if (result.length * 0.75 > (avatar ? 700 * 1024 : 4 * 1024 * 1024)) throw new Error("图片过大，请换一张较小的图片。");
    return result;
  }
  async function fileSource(file) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("请选择 PNG、JPEG 或 WebP 图片。");
    if (file.size > 15 * 1024 * 1024) throw new Error("原图不能超过 15MB。");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("图片读取失败。"));
      reader.readAsDataURL(file);
    });
  }
  async function cropped(source) {
    const blob = await (await fetch(source)).blob();
    return cropper.open(new File([blob], "avatar.webp", { type: blob.type }));
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    document.querySelectorAll('[data-panel="appearance"] button').forEach((button) => { button.disabled = true; });
    try { await action(); }
    catch (error) { message("error", error.message || "外观设置失败，请重试。"); }
    finally { busy = false; render(); }
  }
  async function save(changes) {
    await options.save(changes);
    message("success", "外观已保存，可以继续调整。");
  }
  async function adopt(source) {
    const portrait = await raster(source);
    await save({ personaImageDataUrl: portrait });
    const avatar = await cropped(portrait);
    if (avatar) await save({ avatarDataUrl: avatar });
  }
  function render() {
    if (!options) return;
    const profile = options.profile() || {};
    const portrait = profile.personaImageDataUrl || "";
    const avatar = profile.avatarDataUrl || "";
    for (const [id, source] of [["appearancePortrait", portrait], ["appearanceAvatar", avatar]]) {
      $(`#${id}`).classList.toggle("hidden", !source);
      if (source) $(`#${id}`).src = source;
      else $(`#${id}`).removeAttribute("src");
    }
    $("#portraitPlaceholder").classList.toggle("hidden", Boolean(portrait));
    $("#avatarPlaceholder").classList.toggle("hidden", Boolean(avatar));
    $("#avatarPlaceholder").textContent = Array.from(profile.name || "未命名")[0];
    $("#appearanceName").textContent = profile.name || "你的伙伴";
    document.querySelectorAll('[data-panel="appearance"] button').forEach((button) => { button.disabled = busy; });
    $("#cropPortraitBtn").disabled = busy || !portrait;
    $("#generateAppearanceBtn").disabled = busy || !options.imageReady();
    $("#appearanceImageHint").textContent = options.imageReady()
      ? "描述喜欢的发型、服装、配色等；生成会使用图像模型额度，满意后再采用。"
      : "还未接入图像模型，可以返回接入 AI 配置，也可以直接上传图片。";
  }
  function initialize(config) {
    options = config;
    cropper = new global.AetherAvatarCropper($("#avatarCropModal"));
    $("#uploadPortraitBtn").addEventListener("click", () => $("#portraitFile").click());
    $("#uploadAvatarBtn").addEventListener("click", () => $("#avatarFile").click());
    for (const [id, portrait] of [["portraitFile", true], ["avatarFile", false]]) {
      $(`#${id}`).addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        void run(async () => {
          const source = await fileSource(file);
          if (portrait) await adopt(source);
          else {
            const avatar = await cropped(source);
            if (avatar) await save({ avatarDataUrl: avatar });
          }
        });
      });
    }
    $("#cropPortraitBtn").addEventListener("click", () => run(async () => {
      const avatar = await cropped(options.profile().personaImageDataUrl);
      if (avatar) await save({ avatarDataUrl: avatar });
    }));
    $("#clearAppearanceBtn").addEventListener("click", () => run(() => save({ avatarDataUrl: "", personaImageDataUrl: "" })));
    $("#generateAppearanceBtn").addEventListener("click", () => run(async () => {
      const description = $("#appearancePrompt").value.trim();
      if (!description) throw new Error("先写一点你希望的外观。");
      message("success", "正在生成外观，请稍候…");
      const profile = options.profile();
      const result = await global.desktop.generateImage({
        prompt: `为 AI 伙伴绘制二次元角色人设图，单人、清晰面容、无文字。角色名字：${profile.name}，性别：${profile.gender}。外观要求：${description}`,
        n: 1, response_format: "b64_json"
      });
      if (!result?.ok) throw new Error(result?.data?.error?.message || "生成失败，请检查图像模型配置后重试。");
      const image = result.images?.[0] || result.data?.data?.[0];
      const base64 = image?.b64Json || image?.b64_json;
      const source = base64 ? (base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`) : image?.url;
      if (!source) throw new Error("图像服务没有返回图片，请检查模型是否支持图像生成。");
      candidate = await raster(source);
      $("#generatedPreview").src = candidate;
      $("#generatedCandidate").classList.remove("hidden");
      message("success", "外观已生成，满意后点击采用。");
    }));
    $("#useGeneratedBtn").addEventListener("click", () => run(async () => {
      await adopt(candidate);
      $("#generatedCandidate").classList.add("hidden");
    }));
    $("#saveAppearanceBtn").addEventListener("click", () => run(config.next));
    $("#skipAppearanceBtn").addEventListener("click", () => run(config.next));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !$("#avatarCropModal").classList.contains("hidden")) cropper.close(null);
    });
  }
  async function defaults(choice) {
    if (choice !== "default") return { avatarDataUrl: "", personaImageDataUrl: "" };
    return { avatarDataUrl: await raster(DEFAULT_IMAGE, true), personaImageDataUrl: await raster(DEFAULT_IMAGE) };
  }
  global.OnboardingAppearance = { initialize, render, defaults, isBusy: () => busy };
})(window);
