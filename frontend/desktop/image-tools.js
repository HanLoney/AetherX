(function exposeImageTools(global) {
  const objectSchema = (properties, required = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false
  });
  const stringField = (description) => ({ type: "string", description });

  const DEFAULT_SIZE = "1440x1920";

  function registerImageTools(registry, options = {}) {
    const generateImage = options.generateImage;
    const getPersonaImage = options.getPersonaImage || (() => "");
    const isImageEnabled = options.isImageEnabled || (() => false);
    const illustrator =
      options.illustrator || global.AetherJournalIllustrator || null;
    const size = options.size || DEFAULT_SIZE;

    registry.register({
      name: "image.generate",
      title: "生成一张图片",
      description:
        "当你真心想在对话里给用户看一张画面时，自己画一张图，而不是只用文字描述。画面里有你自己（自拍、你的动作神态）时用 selfie=true，会参考你的人设图保持形象一致；只画场景、物件、风景等不含你本人的画面用 selfie=false。你只能稳定画出你自己，画不出用户或其他真实的人，不要画含他人的「两个人」画面；想表达和用户在一起，就画你自己的神态或你眼中的场景。描述必须是能直接画出来的具体画面：写清场景、你的动作与神态、光线、构图，绝不能写「我想象的画面」这类空泛的话。画自拍（selfie=true）时不要描述自己的外貌——不要写发型、发色、脸型、身材、服装这类长相细节，你的样子完全由人设图决定，写出来反而会和人设图冲突；自拍描述只需写清你在做什么、什么神态、周围场景、光线和构图。所有图都会以二次元动漫风格生成，无需在描述里强调风格。不要为了炫技频繁生成。",
      risk: "write",
      inputSchema: objectSchema(
        {
          description: stringField(
            "要画的具体画面描述：场景、你的动作神态、光线、构图"
          ),
          selfie: {
            type: "boolean",
            description:
              "画面里是否有你自己：有就 true（会参考人设图保持形象一致），只画场景/物件/风景就 false"
          }
        },
        ["description"]
      ),
      async execute(input) {
        try {
          if (typeof generateImage !== "function") {
            throw new Error("当前没有可用的生图能力。");
          }
          if (!isImageEnabled()) {
            throw new Error("生图服务还没接入，请先在图像生成里配置好 API Key。");
          }
          if (!illustrator) {
            throw new Error("生图模块未就绪。");
          }
          const description = String(input.description || "").trim();
          if (!description) throw new Error("画面描述不能为空。");
          const selfie = input.selfie === true;
          const persona = String(getPersonaImage() || "").trim();
          const usePersona = selfie && Boolean(persona);
          const response = await generateImage({
            prompt: illustrator.buildPrompt(description, selfie),
            image: usePersona ? [persona] : undefined,
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
          const source = illustrator.imageSource(
            illustrator.firstImage(response)
          );
          if (!source) throw new Error("图像生成没有返回可用图片。");
          return {
            ok: true,
            content: `已经画好了一张${selfie ? "自拍" : "配图"}：${description}。`,
            data: { description, selfie },
            image: source
          };
        } catch (error) {
          return failure(error);
        }
      }
    });
    return registry;
  }

  function failure(error) {
    const message = error?.message || "图像生成请求失败。";
    return {
      ok: false,
      content: message,
      error: { code: error?.code || "IMAGE_API_ERROR", message }
    };
  }

  global.registerImageTools = registerImageTools;
  if (typeof module !== "undefined") {
    module.exports = { registerImageTools };
  }
})(typeof window === "undefined" ? globalThis : window);
