import type { Metadata } from "next";
import { Workspace } from "@/components/workspace/workspace";
import { archivo, mono } from "@/lib/fonts";

export const metadata: Metadata = { title: "codeviz workspace" };

export default function WorkspacePage() {
  return (
    <div className={archivo.className}>
      <Workspace monoFont={mono.style.fontFamily} />
    </div>
  );
}
