(function () {
    const vscode = acquireVsCodeApi();
    const board = document.getElementById('canvas-board');
    const status = document.getElementById('canvas-status');

    let isDragging = false;
    let currentElement = null;
    let offset = { x: 0, y: 0 };

    vscode.postMessage({ command: 'log', text: '🚀 [Canvas] SCRIPT START' });

    const reconstructBtn = document.getElementById('reconstruct-btn');
    if (reconstructBtn) {
        reconstructBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'reconstruct' });
        });
    }

    // Handle messages from Extension
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'addComponent':
                addComponent(message.data);
                break;
            case 'updateStatus':
                status.textContent = message.text;
                break;
            case 'clear':
                board.innerHTML = '';
                break;
        }
    });

    function addComponent(data) {
        // Remove empty state
        const empty = board.querySelector('.empty-state');
        if (empty) empty.remove();

        const id = data.id || `comp-${Date.now()}`;
        const comp = document.createElement('div');
        comp.className = 'canvas-component';
        comp.id = id;
        comp.style.left = data.x || '50px';
        comp.style.top = data.y || '50px';

        comp.innerHTML = `
            <div class="component-label">${data.label || 'Component'}</div>
            <div class="component-content">${data.content || 'New Component'}</div>
        `;

        comp.addEventListener('mousedown', startDragging);
        board.appendChild(comp);
    }

    function startDragging(e) {
        isDragging = true;
        currentElement = e.currentTarget;
        currentElement.classList.add('selected');

        const rect = currentElement.getBoundingClientRect();
        offset.x = e.clientX - rect.left;
        offset.y = e.clientY - rect.top;

        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', stopDragging);
    }

    function drag(e) {
        if (!isDragging || !currentElement) return;

        const boardRect = board.getBoundingClientRect();
        let x = e.clientX - boardRect.left - offset.x;
        let y = e.clientY - boardRect.top - offset.y;

        // Boundary checks
        x = Math.max(0, Math.min(x, boardRect.width - currentElement.offsetWidth));
        y = Math.max(0, Math.min(y, boardRect.height - currentElement.offsetHeight));

        currentElement.style.left = x + 'px';
        currentElement.style.top = y + 'px';
    }

    function stopDragging() {
        if (isDragging && currentElement) {
            currentElement.classList.remove('selected');

            // Notify Extension of the move
            vscode.postMessage({
                command: 'canvasUpdate',
                data: {
                    id: currentElement.id,
                    x: currentElement.style.left,
                    y: currentElement.style.top
                }
            });
        }

        isDragging = false;
        currentElement = null;
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', stopDragging);
    }

    // Example: Add initial component if board is totally empty
    // addComponent({ label: 'Sample', content: 'Prompt the Sidebar to build something!' });

})();
