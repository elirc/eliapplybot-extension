export type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export const isInput = (element: Element): element is HTMLInputElement => element.tagName === "INPUT";
export const isSelect = (element: Element): element is HTMLSelectElement => element.tagName === "SELECT";
export const isControl = (element: Element): element is Control => ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
const textOf = (element: Element | null) => {
  if (!element) return "";
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll("input,textarea,select,button,script,style").forEach((node) => node.remove());
  return clean(copy.textContent);
};

export function getBestLabel(element: HTMLElement): string {
  const root = element.getRootNode() as Document | ShadowRoot;
  const ids = (element.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  const aria = clean(element.getAttribute("aria-label")) || clean(ids.map((id) => textOf(root.getElementById(id))).join(" "));
  const labels = isControl(element) ? Array.from(element.labels ?? []).map(textOf).filter(Boolean) : [];
  return [...new Set([aria, ...labels, textOf(element.closest("label"))].filter(Boolean))].join(" ");
}
export function getChoiceQuestion(input: HTMLInputElement): string {
  const group = input.closest("[role='radiogroup'],fieldset,[role='group']");
  return group ? getBestLabel(group as HTMLElement) || textOf(group.querySelector(":scope > legend")) : "";
}
export function getNearbyText(element: HTMLElement): string {
  // Local context only, never read a whole form/body or a neighboring section.
  const parent = element.parentElement;
  return parent && !["FORM", "BODY", "HTML"].includes(parent.tagName) ? textOf(parent).slice(0, 300) : "";
}
export function getSectionText(element: HTMLElement): string {
  let current = element.parentElement;
  while (current && !["FORM", "BODY", "HTML"].includes(current.tagName)) {
    const heading = current.querySelector(":scope > h1,:scope > h2,:scope > h3,:scope > h4,:scope > legend,:scope > [role='heading']");
    if (heading) return textOf(heading);
    if (current.matches("section,fieldset,[role='group']")) return getBestLabel(current);
    current = current.parentElement;
  }
  return "";
}
export function getControlValue(element: Control): string {
  if (isInput(element) && ["checkbox", "radio"].includes(element.type)) return element.checked ? getOptionLabel(element) : "";
  return element.value;
}
export function getOptionLabel(input: HTMLInputElement): string {
  return getBestLabel(input) || input.value;
}
