(function exposeAvatarCropper(global) {
  class AvatarCropper {
    constructor(root) {
      this.root = root;
      this.canvas = root.querySelector("[data-crop-canvas]");
      this.context = this.canvas.getContext("2d");
      this.zoomInput = root.querySelector("[data-crop-zoom]");
      this.confirmButton = root.querySelector("[data-crop-confirm]");
      this.cancelButtons = root.querySelectorAll("[data-crop-cancel]");
      this.image = null;
      this.baseScale = 1;
      this.zoom = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.drag = null;
      this.resolve = null;
      this.bind();
    }

    bind() {
      this.zoomInput.addEventListener("input", () => {
        if (!this.image) return;
        const previousScale = this.scale();
        const imageX = (this.canvas.width / 2 - this.offsetX) / previousScale;
        const imageY = (this.canvas.height / 2 - this.offsetY) / previousScale;
        this.zoom = Number(this.zoomInput.value) / 100;
        const nextScale = this.scale();
        this.offsetX = this.canvas.width / 2 - imageX * nextScale;
        this.offsetY = this.canvas.height / 2 - imageY * nextScale;
        this.clamp();
        this.draw();
      });
      this.canvas.addEventListener("pointerdown", (event) => {
        if (!this.image) return;
        this.canvas.setPointerCapture(event.pointerId);
        this.drag = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          offsetX: this.offsetX,
          offsetY: this.offsetY
        };
      });
      this.canvas.addEventListener("pointermove", (event) => {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        const rect = this.canvas.getBoundingClientRect();
        const ratio = this.canvas.width / rect.width;
        this.offsetX =
          this.drag.offsetX + (event.clientX - this.drag.x) * ratio;
        this.offsetY =
          this.drag.offsetY + (event.clientY - this.drag.y) * ratio;
        this.clamp();
        this.draw();
      });
      const stopDragging = (event) => {
        if (this.drag?.pointerId === event.pointerId) this.drag = null;
      };
      this.canvas.addEventListener("pointerup", stopDragging);
      this.canvas.addEventListener("pointercancel", stopDragging);
      this.confirmButton.addEventListener("click", () => this.finish());
      this.cancelButtons.forEach((button) =>
        button.addEventListener("click", () => this.close(null))
      );
      this.root.addEventListener("click", (event) => {
        if (event.target === this.root) this.close(null);
      });
    }

    async open(file) {
      if (!file?.type?.startsWith("image/")) {
        throw new Error("请选择图片文件。");
      }
      if (file.size > 15 * 1024 * 1024) {
        throw new Error("原图不能超过 15MB。");
      }
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      try {
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error("无法读取这张图片。"));
          image.src = objectUrl;
        });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      this.image = image;
      this.baseScale = Math.max(
        this.canvas.width / image.naturalWidth,
        this.canvas.height / image.naturalHeight
      );
      this.zoom = 1;
      this.zoomInput.value = "100";
      this.offsetX =
        (this.canvas.width - image.naturalWidth * this.scale()) / 2;
      this.offsetY =
        (this.canvas.height - image.naturalHeight * this.scale()) / 2;
      this.draw();
      this.root.classList.remove("hidden");
      return new Promise((resolve) => {
        this.resolve = resolve;
      });
    }

    scale() {
      return this.baseScale * this.zoom;
    }

    clamp() {
      const width = this.image.naturalWidth * this.scale();
      const height = this.image.naturalHeight * this.scale();
      this.offsetX = Math.min(0, Math.max(this.canvas.width - width, this.offsetX));
      this.offsetY = Math.min(
        0,
        Math.max(this.canvas.height - height, this.offsetY)
      );
    }

    draw(target = this.canvas) {
      const context =
        target === this.canvas ? this.context : target.getContext("2d");
      const ratio = target.width / this.canvas.width;
      context.clearRect(0, 0, target.width, target.height);
      context.drawImage(
        this.image,
        this.offsetX * ratio,
        this.offsetY * ratio,
        this.image.naturalWidth * this.scale() * ratio,
        this.image.naturalHeight * this.scale() * ratio
      );
    }

    finish() {
      if (!this.image) return;
      const output = document.createElement("canvas");
      output.width = 512;
      output.height = 512;
      this.draw(output);
      this.close(output.toDataURL("image/webp", 0.88));
    }

    close(value) {
      this.root.classList.add("hidden");
      this.image = null;
      const resolve = this.resolve;
      this.resolve = null;
      if (resolve) resolve(value);
    }
  }

  global.AetherAvatarCropper = AvatarCropper;
})(window);
