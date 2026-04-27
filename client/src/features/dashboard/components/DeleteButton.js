import { deleteClassroom } from "../utils/deleteClassroom.js";

/**
 * Appends a delete button to a container.
 * @param {HTMLElement} container - The card element.
 * @param {Object} options - { roomCode, api, onDeleteSuccess }
 */
export function mountDeleteButton(container, { roomCode, api, onDeleteSuccess }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-delete-room";
  btn.setAttribute("aria-label", `Delete classroom ${roomCode}`);
  btn.title = "Delete classroom";
  btn.innerHTML = `
    <svg class="btn-delete-room-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v8h-2V9zm4 0h2v8h-2V9zM7 9h2v8H7V9zm-1 12h12a2 2 0 0 0 2-2V7H4v12a2 2 0 0 0 2 2z"></path>
    </svg>
  `;
  
  btn.onclick = async (e) => {
    e.stopPropagation(); // Prevent navigating to the room when clicking delete
    const result = await deleteClassroom(api, roomCode);
    if (result.ok && onDeleteSuccess) {
      onDeleteSuccess(roomCode);
    }
  };

  container.appendChild(btn);
}