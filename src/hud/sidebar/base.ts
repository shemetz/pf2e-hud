import {
    MODULE,
    R,
    addListenerAll,
    createHTMLElement,
    elementDataset,
    hasSpells,
    htmlClosest,
    htmlQuery,
    isOwnedItem,
    render,
    templateLocalize,
    templatePath,
} from "module-api";
import { PF2eHudBaseActor } from "../base/actor";
import { IPF2eHudAdvanced } from "../base/advanced";
import { GlobalSettings } from "../base/base";
import {
    addEnterKeyListeners,
    addSendItemToChatListeners,
    getItemFromElement,
} from "../shared/listeners";
import { PF2eHudItemPopup } from "../popup/item";
import { addDragoverListener } from "../shared/advanced";

const SIDEBARS = [
    {
        type: "actions",
        icon: "fa-solid fa-sword",
        disabled: (actor: ActorPF2e) => false,
    },
    {
        type: "items",
        icon: "fa-solid fa-backpack",
        disabled: (actor: ActorPF2e) => actor.inventory.size < 1,
    },
    {
        type: "spells",
        icon: "fa-solid fa-wand-magic-sparkles",
        disabled: (actor: ActorPF2e) => !hasSpells(actor),
    },
    {
        type: "skills",
        icon: "fa-solid fa-hand",
        disabled: (actor: ActorPF2e) => false,
    },
    {
        type: "extras",
        icon: "fa-solid fa-cubes",
        disabled: (actor: ActorPF2e) => false,
    },
] as const;

const ROLLOPTIONS_PLACEMENT = {
    actions: "actions",
    spells: "spellcasting",
    items: "inventory",
    skills: "proficiencies",
    extras: undefined,
} as const;

abstract class PF2eHudSidebar extends foundry.applications.api
    .ApplicationV2<ApplicationConfiguration> {
    #innerElement!: HTMLElement;
    #parentHud: IPF2eHudAdvanced & PF2eHudBaseActor;

    static DEFAULT_OPTIONS: PartialApplicationConfiguration = {
        id: "pf2e-hud-sidebar",
        window: {
            positioned: true,
            resizable: false,
            minimizable: false,
            frame: false,
        },
        position: {
            width: "auto",
            height: "auto",
        },
    };

    constructor(
        parent: IPF2eHudAdvanced & PF2eHudBaseActor,
        options?: Partial<ApplicationConfiguration>
    ) {
        super(options);
        this.#parentHud = parent;
    }

    abstract get key(): SidebarName;

    get partials(): string[] {
        return ["item_image"];
    }

    get parenHUD() {
        return this.#parentHud;
    }

    get actor() {
        return this.parenHUD.actor!;
    }

    get innerElement() {
        return this.#innerElement;
    }

    get scrollElement() {
        return htmlQuery(this.innerElement, ".item-list");
    }

    get itemElements() {
        return this.innerElement.querySelectorAll<HTMLElement>(".item[data-item-id]");
    }

    get sidebars() {
        return htmlQuery(this.innerElement, ":scope > .sidebars");
    }

    /**
     * total height if there was overflow allowed
     */
    get virtualHeight() {
        const scrollElement = this.scrollElement;
        return scrollElement?.scrollHeight ?? 0;
    }

    /**
     * max height limited by the parent hud allotted bounds
     */
    get maxHeight() {
        const { limits } = this.parenHUD.anchor;
        const style = getComputedStyle(this.element);
        const paddingTop = parseFloat(style.paddingTop);
        const paddingBottom = parseFloat(style.paddingBottom);
        const allottedHeight = (limits?.bottom ?? window.innerHeight) - (limits?.top ?? 0);
        return (
            (allottedHeight - paddingTop - paddingBottom) * (this.getSetting("sidebarHeight") / 100)
        );
    }

    abstract _activateListeners(html: HTMLElement): void;

    async _preFirstRender(
        context: ApplicationRenderContext,
        options: ApplicationRenderOptions
    ): Promise<void> {
        const templates: Set<string> = new Set();

        for (const partial of this.partials) {
            const path = templatePath("partials", partial);
            templates.add(path);
        }

        await loadTemplates(Array.from(templates));
    }

    _configureRenderOptions(options: SidebarRenderOptions) {
        super._configureRenderOptions(options);
        options.fontSize = this.getSetting("sidebarFontSize");
    }

    async _prepareContext(options: SidebarRenderOptions): Promise<SidebarContext> {
        return {
            i18n: templateLocalize(`sidebars.${this.key}`),
            partial: (key: string) => templatePath("partials", key),
        };
    }

    async _renderHTML(
        context: SidebarContext,
        options: SidebarRenderOptions
    ): Promise<HTMLElement> {
        const sidebarTemplate = await render("sidebars", this.key, context);

        const listElement = createHTMLElement("div", {
            classes: ["item-list"],
            innerHTML: sidebarTemplate,
        });

        const sidebarsElement = createHTMLElement("div", {
            classes: ["sidebars"],
            innerHTML: await render("partials/sidebars", {
                sidebars: getSidebars(this.actor, this.key),
            }),
        });

        const innerElement = createHTMLElement("div", {
            classes: ["inner", this.key, this.parenHUD.key],
            dataset: { tooltipDirection: "UP", sidebar: this.key },
            children: [sidebarsElement, listElement],
        });

        const placement = ROLLOPTIONS_PLACEMENT[this.key];
        if (placement) {
            const toggles = R.pipe(
                R.values(this.actor.synthetics.toggles).flatMap((domain) => Object.values(domain)),
                R.filter((option) => option.placement === placement)
            );

            if (toggles.length) {
                const togglesTemplate = await render("sidebars/rolloptions", { toggles });
                const togglesElement = createHTMLElement("div", {
                    innerHTML: togglesTemplate,
                });

                listElement.prepend(...togglesElement.children);
            }
        }

        return innerElement;
    }

    _replaceHTML(result: HTMLElement, content: HTMLElement, options: SidebarRenderOptions) {
        content.style.setProperty("--font-size", `${options.fontSize}px`);

        const oldElement = this.#innerElement;
        const focusName = oldElement?.querySelector<HTMLInputElement>("input:focus")?.name;

        const scrollPositions = (() => {
            if (!oldElement || oldElement.dataset.sidebar !== result.dataset.sidebar) return;

            const scrollElement = this.scrollElement;
            if (!scrollElement) return;

            return { left: scrollElement.scrollLeft, top: scrollElement.scrollTop };
        })();

        this.#innerElement = result;

        if (oldElement) oldElement.replaceWith(this.#innerElement);
        else content.appendChild(this.#innerElement);

        if (focusName) {
            this.#innerElement
                .querySelector<HTMLInputElement>(`input[name="${focusName}"]`)
                ?.focus();
        }

        if (scrollPositions) {
            const scrollElement = this.scrollElement!;
            scrollElement.scrollLeft = scrollPositions.left;
            scrollElement.scrollTop = scrollPositions.top;
        }

        this.#activateListeners(this.#innerElement);
        this._activateListeners(this.#innerElement);
    }

    _onRender(context: ApplicationRenderContext, options: SidebarRenderOptions) {
        const innerElement = this.innerElement;

        if (this.getSetting("multiColumns")) {
            const maxHeight = this.maxHeight;
            const virtualHeight = this.virtualHeight;
            const columns = Math.clamp(Math.ceil(virtualHeight / maxHeight), 1, 3);

            if (columns > 1) {
                innerElement.style.setProperty("--nb-columns", String(columns));
            } else {
                innerElement.style.removeProperty("--nb-columns");
            }
        }

        const sidebars = this.sidebars;
        sidebars?.classList.toggle("bottom", innerElement.offsetHeight < sidebars.offsetHeight);

        for (const itemElement of this.itemElements) {
            const nameElement = itemElement.querySelector<HTMLElement>(".name");
            if (nameElement && nameElement.scrollWidth > nameElement.offsetWidth) {
                nameElement.dataset.tooltip = nameElement.innerHTML.trim();
            }
        }
    }

    _updatePosition(position = {} as ApplicationPosition) {
        const element = this.element;
        if (!element) return position;

        const anchor = this.parenHUD.anchor;
        const maxHeight = this.maxHeight;
        const bounds = element.getBoundingClientRect();
        const center: Point = { x: anchor.x, y: anchor.y };
        const limitRight = anchor.limits?.right ?? window.innerWidth;
        const limitBottom = anchor.limits?.bottom ?? window.innerHeight;

        position.left = center.x - bounds.width / 2;
        position.top = center.y - bounds.height / 2;

        if (position.left + bounds.width > limitRight) position.left = limitRight - bounds.width;
        if (position.left < 0) position.left = 0;
        if (position.top + bounds.height > limitBottom) position.top = limitBottom - bounds.height;
        if (position.top < 0) position.top = 0;

        element.style.setProperty("left", `${position.left}px`);
        element.style.setProperty("top", `${position.top}px`);
        element.style.setProperty("--max-height", `${maxHeight}px`);

        if (center.x <= 0 || center.x >= limitRight || center.y <= 0 || center.y >= limitBottom) {
            element.style.setProperty("display", "none");
            return position;
        } else {
            element.style.removeProperty("display");
        }

        return position;
    }

    _onPosition(position: ApplicationPosition) {
        requestAnimationFrame(() => this._updatePosition());
    }

    async close(options: ApplicationClosingOptions = {}): Promise<this> {
        options.animate = false;
        return super.close(options);
    }

    getSetting<K extends keyof SidebarSettings & string>(key: K): SidebarSettings[K];
    getSetting<K extends keyof GlobalSettings & string>(key: K): GlobalSettings[K];
    getSetting<K extends (keyof SidebarSettings | keyof GlobalSettings) & string>(key: K) {
        return this.parenHUD.getSetting(key as any);
    }

    #activateListeners(html: HTMLElement) {
        addEnterKeyListeners(html);
        addDragoverListener(this.element);
        addSendItemToChatListeners(this.actor, html);

        addListenerAll(html, "[data-action='item-description']", (event, el) => {
            const actor = this.actor;
            const item = getItemFromElement(actor, el);
            if (!isOwnedItem(item)) return;
            new PF2eHudItemPopup({ actor, item, event }).render(true);
        });

        addListenerAll(html, "[data-action='toggle-roll-option']", "change", (event, el) => {
            const toggleRow = htmlClosest(el, "[data-item-id][data-domain][data-option]");
            const checkbox = htmlQuery<HTMLInputElement>(
                toggleRow,
                "input[data-action=toggle-roll-option]"
            );
            const suboptionsSelect = htmlQuery<HTMLSelectElement>(
                toggleRow,
                "select[data-action=set-suboption"
            );
            const { domain, option, itemId } = toggleRow?.dataset ?? {};
            const suboption = suboptionsSelect?.value ?? null;

            if (checkbox && domain && option) {
                this.actor.toggleRollOption(
                    domain,
                    option,
                    itemId ?? null,
                    checkbox.checked,
                    suboption
                );
            }
        });

        addListenerAll(html, "[data-action='open-sidebar']", (event, el) => {
            const sidebar = el.dataset.sidebar as SidebarName;
            this.parenHUD.toggleSidebar(sidebar);
        });

        addListenerAll(
            html,
            "input[data-item-id][data-item-property]",
            "change",
            (event, el: HTMLInputElement) => {
                event.stopPropagation();
                const { itemId, itemProperty } = elementDataset(el);
                this.actor.updateEmbeddedDocuments("Item", [
                    {
                        _id: itemId,
                        [itemProperty]: el.valueAsNumber,
                    },
                ]);
            }
        );
    }
}

function getSidebars(actor: ActorPF2e, active?: SidebarName) {
    return SIDEBARS.map(
        ({ type, disabled, icon }): SidebarMenu => ({
            type,
            icon,
            label: MODULE.path("sidebars", type, "title"),
            disabled: disabled(actor),
            active: active === type,
        })
    );
}

type SidebarContext = {
    i18n: ReturnType<typeof templateLocalize>;
    partial: (template: string) => string;
};

type SidebarRenderOptions = ApplicationRenderOptions & {
    fontSize: number;
};

type SidebarName = (typeof SIDEBARS)[number]["type"];

type SidebarEvent = "cast-spell";

type SidebarMenu = {
    type: SidebarName;
    icon: string;
    label: string;
    disabled: boolean;
    active: boolean;
};

type SidebarSettings = {
    sidebarFontSize: number;
    sidebarHeight: number;
    multiColumns: boolean;
};

export { PF2eHudSidebar, getSidebars };
export type {
    SidebarContext,
    SidebarEvent,
    SidebarMenu,
    SidebarName,
    SidebarRenderOptions,
    SidebarSettings,
};
