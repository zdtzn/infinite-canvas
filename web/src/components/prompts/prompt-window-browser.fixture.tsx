import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PromptWindowGrid } from "./prompt-window-grid";
import type { Prompt } from "@/services/api/prompts";

declare global {
    interface Window {
        promptQA: { active: (value: boolean) => void; header: (value: number) => void; replace: (value: number) => void };
    }
}
const makeItems = (height: number) => Array.from({ length: 1000 }, (_, id) => ({ id: String(id), category: "fixture", title: String(height) }) as Prompt);
function Fixture() {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(true);
    const [header, setHeader] = useState(400);
    const [items, setItems] = useState(() => makeItems(140));
    window.promptQA = { active: setActive, header: setHeader, replace: (height) => setItems(makeItems(height)) };
    return (
        <>
            <style>{`body { margin: 0; padding: 40px; } #scroller { height: 420px; overflow: auto; border: 7px solid black; } .qa-grid { position: relative; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; } [data-prompt-row] { position:absolute; left:0; top:0; display:grid; width:100%; } [data-prompt-item] { display:grid; min-width:0; } .card { box-sizing:border-box; border:1px solid blue; padding:12px; } @media(max-width:700px) { .qa-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } } @media(max-width:450px) { .qa-grid { grid-template-columns: minmax(0,1fr); } }`}</style>
            <button id="before">Before</button>
            <div id="scroller" ref={scrollRef} style={{ display: active ? "block" : "none" }}>
                <div id="header" style={{ height: header }}>
                    Header
                </div>
                <section>
                    <PromptWindowGrid
                        active={active}
                        items={items}
                        scrollRef={scrollRef}
                        className="qa-grid"
                        renderItem={(item) => (
                            <div className="card" style={{ height: Number(item.title) + (Number(item.id) % 3) * 10 }}>
                                <button data-action={`${item.id}-open`}>Open {item.id}</button>
                                <button data-action={`${item.id}-copy`}>Copy {item.id}</button>
                                <button hidden>Hidden action</button>
                                <button tabIndex={-1}>Not in tab order</button>
                            </div>
                        )}
                    />
                </section>
                <button id="after">After</button>
            </div>
        </>
    );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
