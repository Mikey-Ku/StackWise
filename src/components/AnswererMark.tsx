import type { CSSProperties } from "react";
import { answererLogo, type RecipientId } from "./answerers";
import { cx } from "./ui";

/** An answerer's logo. One-color marks are drawn as a mask in the current text color, so a black mark never vanishes in dark mode. */
export function AnswererMark({ id, className }: { id: RecipientId; className?: string }) {
  const mark = answererLogo(id);
  if (!mark) return null;
  if (mark.mono) {
    const url = `url(${mark.src})`;
    return <span className={cx("ws-amark ws-amark--mono", className)} style={{ maskImage: url, WebkitMaskImage: url } as CSSProperties} aria-hidden />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- a committed brand icon
  return <img className={cx("ws-amark", className)} src={mark.src} alt="" />;
}
