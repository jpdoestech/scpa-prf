let nextId = 0;
const controls = new WeakMap();
let fitOpenMenu;
window.visualViewport?.addEventListener('resize', () => fitOpenMenu?.());
window.visualViewport?.addEventListener('scroll', () => fitOpenMenu?.());

export function enhanceSelects(root) {
  for (const select of root.querySelectorAll('select[data-search-select]')) {
    const id = `select-search-${++nextId}`;
    const labels = [...select.labels];
    const name = select.getAttribute('aria-label') || labels.map(label => {
      const heading = label.cloneNode(true);
      heading.querySelectorAll('select,small').forEach(node => node.remove());
      return heading.textContent.trim();
    }).join(' ');
    const control = document.createElement('div');
    control.className = 'search-select';
    control.innerHTML = `<input id="${id}" type="text" role="combobox" aria-autocomplete="list"
      aria-expanded="false" aria-controls="${id}-list" autocomplete="off" spellcheck="false">
      <span class="select-value" aria-hidden="true"></span>
      <button type="button" class="select-toggle" tabindex="-1" aria-label="Show options">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="select-menu" hidden><div id="${id}-list" role="listbox"></div>
        <p role="status" class="select-message"></p></div>`;
    const input = control.querySelector('input');
    const selectedLabel = control.querySelector('.select-value');
    const toggle = control.querySelector('button');
    const menu = control.querySelector('.select-menu');
    const list = control.querySelector('[role="listbox"]');
    const message = control.querySelector('[role="status"]');
    input.setAttribute('aria-label', name);
    list.setAttribute('aria-label', name);
    toggle.setAttribute('aria-label', `Show ${name.toLowerCase()} options`);
    for (const label of labels) label.htmlFor = id;
    select.after(control);
    select.hidden = true;
    controls.set(select, input);

    let matches = [];
    let active = -1;

    function sync() {
      const label = select.selectedOptions[0]?.label ?? '';
      input.value = !select.required || select.value ? label : '';
      input.placeholder = select.required && !select.value ? label : 'Select an option';
      selectedLabel.textContent = input.value || input.placeholder;
      selectedLabel.classList.toggle('is-placeholder', !input.value);
      if (select.validity.valid) input.removeAttribute('aria-invalid');
    }

    function highlight(index, scroll = false) {
      list.children[active]?.classList.remove('active');
      active = index;
      const item = list.children[active];
      if (item) {
        item.classList.add('active');
        input.setAttribute('aria-activedescendant', item.id);
        if (scroll) item.scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function fitMenu() {
      if (!control.isConnected) {
        fitOpenMenu = undefined;
        return;
      }
      const rect = control.getBoundingClientRect();
      const viewport = window.visualViewport;
      const above = rect.top - (viewport?.offsetTop ?? 0) - 12;
      const below = (viewport ? viewport.height + viewport.offsetTop : window.innerHeight) - rect.bottom - 12;
      const up = below < 180 && above > below;
      menu.classList.toggle('select-menu-up', up);
      menu.style.maxHeight = `${Math.max(72, Math.min(up ? above : below, 272))}px`;
    }

    function render(query = '') {
      const term = query.trim().toLowerCase();
      matches = [...select.options].filter(option => !option.disabled && !option.hidden
        && (!select.required || option.value) && option.label.toLowerCase().includes(term));
      list.replaceChildren(...matches.map((option, index) => {
        const item = document.createElement('div');
        item.id = `${id}-option-${index}`;
        item.dataset.index = index;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.textContent = option.label;
        return item;
      }));
      message.textContent = matches.length ? '' : (term ? 'No matching options.' : 'No options available.');
      active = -1;
      highlight(Math.max(0, matches.findIndex(option => option.selected)));
      menu.scrollTop = 0;
      if (!term && active > 0) highlight(active, true);
    }

    function open() {
      if (!menu.hidden) return;
      control.classList.add('is-open');
      menu.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      fitOpenMenu = fitMenu;
      fitMenu();
      render();
    }

    function close() {
      control.classList.remove('is-open');
      menu.hidden = true;
      if (fitOpenMenu === fitMenu) fitOpenMenu = undefined;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      sync();
    }

    function choose(index) {
      const option = matches[index];
      if (!option) return;
      const changed = !option.selected;
      select.selectedIndex = option.index;
      close();
      if (changed) {
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    sync();
    input.addEventListener('focus', () => {
      if (select.required) input.setAttribute('aria-required', 'true');
      else input.removeAttribute('aria-required');
      input.select();
    });
    input.addEventListener('click', () => {
      if (!menu.hidden) return;
      open();
      input.select();
    });
    input.addEventListener('input', () => {
      open();
      render(input.value);
    });
    input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (menu.hidden) {
          open();
          input.select();
        } else if (matches.length) {
          const offset = event.key === 'ArrowDown' ? 1 : -1;
          highlight(Math.max(0, Math.min(active + offset, matches.length - 1)), true);
        }
      } else if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault();
        close();
      } else if (event.key === 'Enter' && !menu.hidden) {
        event.preventDefault();
        choose(active);
      }
    });
    control.addEventListener('focusout', event => {
      if (!menu.hidden && !control.contains(event.relatedTarget)) close();
    });
    toggle.addEventListener('mousedown', event => event.preventDefault());
    toggle.addEventListener('click', () => {
      if (menu.hidden) {
        input.focus({ preventScroll: true });
        open();
        input.select();
      } else close();
    });
    list.addEventListener('mousedown', event => event.preventDefault());
    list.addEventListener('click', event => {
      const item = event.target.closest('[data-index]');
      if (item) choose(Number(item.dataset.index));
    });
    select.addEventListener('change', close);
    select.addEventListener('invalid', event => {
      event.preventDefault();
      input.setAttribute('aria-invalid', 'true');
      if (select.form?.querySelector(':invalid') !== select) return;
      // Native validation may focus another field after reporting this hidden select.
      setTimeout(() => {
        if (!select.isConnected || select.validity.valid) return;
        input.focus();
        open();
        message.textContent = 'Choose an option.';
      }, 0);
    });
  }
}

export function focusSelect(select) {
  (controls.get(select) ?? select)?.focus({ preventScroll: true });
}
