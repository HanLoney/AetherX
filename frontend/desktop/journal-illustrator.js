(function exposeJournalIllustrator(global) {
  // 占位符必须独占一行才生效，避免正文里引用/举例这套语法时被误当成真占位符。
  const PLACEHOLDER_PATTERN =
    /^[ \t]*(\[\[\s*(自拍|配图)\s*[:：]\s*([^\]\n]+?)\s*\]\])[ \t]*$/gm;
  const DEFAULT_MAX_IMAGES = 2;
  const DEFAULT_SIZE = "1440x2560";
  const STYLE_SUFFIX =
    "日系二次元动漫插画风格，柔和干净的赛璐璐上色，细腻线条与通透光影，温柔氛围，不要写实照片质感，不要文字、水印或多余边框。";
  const PERSONA_SUFFIX =
    "这是画面主角本人的自拍/写照，请严格以人设图为准还原角色的外貌、发型、发色、瞳色、气质与穿衣风格；若文字描述与人设图在外貌、发型、发色、瞳色或服装上有冲突，一律以人设图为准，保持同一个角色的一致形象。";

  function extractPlaceholders(content) {
    const source = String(content || "");
    const placeholders = [];
    let match;
    PLACEHOLDER_PATTERN.lastIndex = 0;
    while ((match = PLACEHOLDER_PATTERN.exec(source))) {
      const description = String(match[3] || "").trim();
      if (!description) continue;
      placeholders.push({
        raw: match[1],
        description,
        selfie: match[2] === "自拍"
      });
    }
    return placeholders;
  }

  function buildPrompt(description, isSelfie) {
    return [description, isSelfie ? PERSONA_SUFFIX : "", STYLE_SUFFIX]
      .filter(Boolean)
      .join(" ");
  }

  function detectImageMime(b64) {
    if (b64.startsWith("/9j/")) return "image/jpeg";
    if (b64.startsWith("iVBORw0KGgo")) return "image/png";
    if (b64.startsWith("UklGR")) return "image/webp";
    if (b64.startsWith("R0lGOD")) return "image/gif";
    return "image/png";
  }

  function imageSource(image) {
    if (!image) return "";
    const b64 = String(image.b64Json || "").trim();
    if (b64) {
      return b64.startsWith("data:")
        ? b64
        : `data:${detectImageMime(b64)};base64,${b64}`;
    }
    return String(image.url || "").trim();
  }

  function firstImage(result) {
    if (Array.isArray(result?.images) && result.images.length) {
      return result.images[0];
    }
    const candidates = Array.isArray(result?.data?.data)
      ? result.data.data
      : Array.isArray(result?.data?.images)
        ? result.data.images
        : [];
    const item = candidates[0];
    if (!item) return null;
    return {
      url: item.url || item.image_url || item.imageUrl || "",
      b64Json: item.b64_json || item.b64Json || item.base64 || ""
    };
  }

  function stripPlaceholder(content, raw) {
    return content
      .replace(new RegExp(`\\n*[ \\t]*${escapeRegExp(raw)}[ \\t]*\\n*`), "\n\n")
      .replace(/\n{3,}/g, "\n\n");
  }

  function embedImage(content, raw, description, source) {
    const markdown = `\n\n![${sanitizeAlt(description)}](${source})\n\n`;
    return content
      .replace(new RegExp(`\\n*[ \\t]*${escapeRegExp(raw)}[ \\t]*\\n*`), markdown)
      .replace(/\n{3,}/g, "\n\n");
  }

  function sanitizeAlt(value) {
    return String(value || "").replace(/[\[\]]/g, "").slice(0, 120);
  }

  function stripForeignImages(content) {
    return String(content || "")
      .replace(/!\[[^\]]*\]\((?!data:)[^)\s]*\)/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async function illustrate(content, options = {}) {
    const generateImage = options.generateImage;
    if (typeof generateImage !== "function") {
      return stripAllPlaceholders(content);
    }
    const personaImage = String(options.personaImage || "").trim();
    const maxImages = Math.max(0, Number(options.maxImages ?? DEFAULT_MAX_IMAGES));
    const size = options.size || DEFAULT_SIZE;
    const onError = options.onError || (() => {});
    const onImage = options.onImage || (() => {});

    let result = stripForeignImages(content);
    const placeholders = extractPlaceholders(result);
    let rendered = 0;

    for (const placeholder of placeholders) {
      if (rendered >= maxImages) {
        result = stripPlaceholder(result, placeholder.raw);
        continue;
      }
      const useSelfiePersona = placeholder.selfie && Boolean(personaImage);
      try {
        const response = await generateImage({
          prompt: buildPrompt(placeholder.description, placeholder.selfie),
          image: useSelfiePersona ? [personaImage] : undefined,
          responseFormat: "b64_json",
          n: 1,
          size
        });
        if (!response?.ok) {
          throw new Error(
            response?.data?.error?.message ||
              response?.data?.message ||
              `图像生成失败，HTTP ${response?.status || "未知"}`
          );
        }
        const source = imageSource(firstImage(response));
        if (!source) throw new Error("图像生成没有返回可用图片。");
        result = embedImage(result, placeholder.raw, placeholder.description, source);
        rendered += 1;
        onImage({
          description: placeholder.description,
          selfie: placeholder.selfie
        });
      } catch (error) {
        onError(error, placeholder);
        result = stripPlaceholder(result, placeholder.raw);
      }
    }
    return result;
  }

  function stripAllPlaceholders(content) {
    let result = stripForeignImages(content);
    for (const placeholder of extractPlaceholders(result)) {
      result = stripPlaceholder(result, placeholder.raw);
    }
    return result;
  }

  const api = Object.freeze({
    PLACEHOLDER_PATTERN,
    extractPlaceholders,
    buildPrompt,
    imageSource,
    firstImage,
    illustrate,
    stripAllPlaceholders,
    stripForeignImages
  });

  global.AetherJournalIllustrator = api;
  if (typeof module !== "undefined") {
    module.exports = api;
  }
})(typeof window === "undefined" ? globalThis : window);
