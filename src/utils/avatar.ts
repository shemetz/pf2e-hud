import {
    addListener,
    addListenerAll,
    getFlag,
    htmlQuery,
    render,
    setFlag,
    subLocalize,
} from "foundry-pf2e";

const localize = subLocalize("utils.avatar");

class PF2eHudAvatarEditor extends foundry.applications.api.ApplicationV2 {
    #actor: CharacterPF2e | NPCPF2e;
    #img!: HTMLImageElement;
    #src!: string;
    #scale!: number;
    #scaleX!: number;
    #scaleY!: number;
    #offsetX!: number;
    #offsetY!: number;

    static DEFAULT_OPTIONS: PartialApplicationConfiguration = {
        window: {
            resizable: false,
            minimizable: true,
        },
        position: {
            width: 600,
        },
        id: "pf2e-hud-avatar-editor",
    };

    constructor(actor: CharacterPF2e | NPCPF2e, options: PartialApplicationConfiguration = {}) {
        foundry.utils.mergeObject(options, {
            window: {
                title: localize("title", { name: actor.name }),
            },
        });

        super(options);

        this.#actor = actor;
    }

    get actor() {
        return this.#actor;
    }

    get imageElement() {
        return htmlQuery(this.element, ".viewport .image")!;
    }

    async _prepareContext(options: ApplicationRenderOptions): Promise<AvatarContext> {
        const actor = this.actor;

        return {
            placeholder: actor.img,
            noBrowser: !game.user.can("FILES_BROWSE"),
            noTokenImage: VideoHelper.hasVideoExtension(actor.prototypeToken.texture.src),
        };
    }

    async _renderHTML(context: ApplicationRenderContext, options: ApplicationRenderOptions) {
        return render("avatar/editor", {
            ...context,
            i18n: localize.i18n,
        });
    }

    _replaceHTML(result: string, content: HTMLElement, options: ApplicationRenderOptions) {
        content.innerHTML = result;

        const actor = this.actor;
        const flag = getFlag<AvatarData>(actor, "avatar");

        requestAnimationFrame(async () => {
            await this.#setImage(flag?.src ?? actor.img);

            if (flag) {
                const imageElement = this.imageElement;
                const offsetX = flag.position.x * imageElement.clientWidth;
                const offsetY = flag.position.y * imageElement.clientHeight;

                this.setImageScale(flag.scale);
                this.setImagePosition(offsetX, offsetY);
            } else {
                this.containImage();
            }
        });

        this.#activateListeners(content);
    }

    async changeImage(src: string) {
        await this.#setImage(src);
        this.containImage();
    }

    containImage() {
        const width = this.#img.width;
        const height = this.#img.height;

        this.#scale = 1;
        this.#scaleX = height >= width ? width / height : 1;
        this.#scaleY = height >= width ? 1 : height / width;

        this.imageElement.style.backgroundSize = `${this.#scaleX * 100}% ${this.#scaleY * 100}%`;

        this.#centerImage();
    }

    setImageScale(value: number) {
        const width = this.#img.width;
        const height = this.#img.height;

        this.#scale = value;
        this.#scaleX = (height >= width ? width / height : 1) * value;
        this.#scaleY = (height >= width ? 1 : height / width) * value;

        this.imageElement.style.backgroundSize = `${this.#scaleX * 100}% ${this.#scaleY * 100}%`;
    }

    async saveData() {
        const data: AvatarData = {
            src: this.#src,
            scale: this.#scale,
            scales: {
                x: this.#scaleX,
                y: this.#scaleY,
            },
            position: {
                x: this.#offsetX / this.imageElement.clientWidth,
                y: this.#offsetY / this.imageElement.clientHeight,
            },
        };

        return setFlag(this.actor, "avatar", data);
    }

    setImagePosition(x: number, y: number) {
        this.#offsetX = x;
        this.#offsetY = y;

        this.imageElement.style.backgroundPosition = `${x}px ${y}px`;
    }

    #centerImage() {
        const imageElement = this.imageElement;

        const width = imageElement.clientWidth * this.#scaleX;
        const height = imageElement.clientHeight * this.#scaleY;

        this.#offsetX = (imageElement.clientWidth - width) / 2;
        this.#offsetY = (imageElement.clientHeight - height) / 2;

        imageElement.style.backgroundPosition = `${this.#offsetX}px ${this.#offsetY}px`;
    }

    async #setImage(src: string) {
        const url = `url("${src}")`;

        this.#src = src;
        this.#img = await this.#loadImage(src);

        htmlQuery(this.element, "input")!.value = src;
        this.imageElement.style.backgroundImage = url;
    }

    #loadImage(src: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    #activateListeners(html: HTMLElement) {
        const actor = this.actor;

        addListener(html, ".image", "wheel", (event) => {
            const delta = event.deltaY >= 0 ? -1 : 1;
            this.setImageScale(this.#scale + delta * 0.05);
        });

        addListener(html, ".image", "pointerdown", (event, el) => {
            const originX = event.pageX;
            const originY = event.pageY;
            const originOffsetX = this.#offsetX;
            const originOffsetY = this.#offsetY;

            let offsetX = originOffsetX;
            let offsetY = originOffsetY;

            const pointerMove = (event: PointerEvent) => {
                offsetX = originOffsetX + (event.pageX - originX);
                offsetY = originOffsetY + (event.pageY - originY);

                el.style.backgroundPosition = `${offsetX}px ${offsetY}px`;
            };

            const pointerUp = (event: PointerEvent) => {
                el.removeEventListener("pointermove", pointerMove);
                this.setImagePosition(offsetX, offsetY);
            };

            el.addEventListener("pointermove", pointerMove);
            window.addEventListener("pointerup", pointerUp, { once: true });
        });

        addListenerAll(html, "[data-action]", async (event, el) => {
            const action = el.dataset.action as EventAction;

            switch (action) {
                case "open-browser": {
                    const parent = el.parentElement as HTMLElement;
                    const input = htmlQuery(parent, "input") as HTMLInputElement;
                    const current = input.src || input.placeholder;

                    new FilePicker({
                        callback: (src) => this.changeImage(src),
                        allowUpload: false,
                        type: "image",
                        current,
                    }).render(true);

                    break;
                }

                case "use-actor-image": {
                    this.changeImage(actor.img);
                    break;
                }

                case "use-token-image": {
                    this.changeImage(actor.prototypeToken.texture.src);
                    break;
                }

                case "cancel": {
                    this.close();
                    break;
                }

                case "save": {
                    await this.saveData();
                    this.close();
                    break;
                }

                case "contain": {
                    this.containImage();
                    break;
                }
            }
        });
    }
}

function editAvatar(actor: ActorPF2e) {
    if (!actor.isOfType("character", "npc")) {
        return;
    }

    new PF2eHudAvatarEditor(actor).render(true);
}

type EventAction =
    | "open-browser"
    | "use-actor-image"
    | "use-token-image"
    | "contain"
    | "save"
    | "cancel";

type AvatarData = {
    src: string;
    scale: number;
    scales: {
        x: number;
        y: number;
    };
    position: {
        x: number;
        y: number;
    };
};

type AvatarContext = {
    placeholder: string;
    noBrowser: boolean;
    noTokenImage: boolean;
};

export { editAvatar };
export type { AvatarData };
