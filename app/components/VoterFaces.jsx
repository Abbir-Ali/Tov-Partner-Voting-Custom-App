/**
 * VoterFaces component: overlapping avatar circles for voter display.
 * Shows up to 5 faces with done/pending state and summary text.
 *
 * Used in: Boards list, Home latest boards, Board detail.
 */
import { AVATAR_BG } from "../models/avatars.shared.js";

/* eslint-disable react/prop-types */
/**
 * @param {object} props
 * @param {Array<{firstName: string, avatarKey: string, done: boolean}>} props.voters
 * @param {string} props.summary - e.g. "2 of 3 voted"
 */
export function VoterFaces({ voters, summary }) {
  if (!voters || voters.length === 0) {
    return <span style={{ color: "#6d7175" }}>No voters</span>;
  }

  return (
    <div className="pvb-voters">
      <div className="pvb-voter-faces">
        {voters.map((v, i) => {
          const bg = AVATAR_BG[v.avatarKey] || "#DCE3E1";
          return (
            <span
              key={i}
              className="pvb-voter-face"
              data-done={v.done}
              style={{ backgroundColor: bg }}
              title={`${v.firstName}${v.done ? " (voted)" : ""}`}
              aria-label={`${v.firstName}${v.done ? " (voted)" : ""}`}
            >
              <svg viewBox="0 0 96 96" style={{ width: "100%", height: "100%" }}>
                <use href={`#pvb-av-${v.avatarKey || "sam"}`} />
              </svg>
            </span>
          );
        })}
      </div>
      <span className="pvb-voter-summary">{summary}</span>
    </div>
  );
}
/* eslint-enable react/prop-types */

/**
 * CSS styles for VoterFaces. Include in page styles.
 */
export const VOTER_FACES_STYLES = `
  .pvb-voters { display: flex; align-items: center; gap: 8px; }
  .pvb-voter-faces { display: flex; flex-direction: row-reverse; justify-content: flex-end; }
  .pvb-voter-face { width: 28px; height: 28px; border-radius: 50%; border: 2px solid #fff; margin-left: -8px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .pvb-voter-face:last-child { margin-left: 0; }
  .pvb-voter-face[data-done="false"] { opacity: 0.5; }
  .pvb-voter-summary { font-size: 12px; color: #6d7175; white-space: nowrap; }
`;
