// Oriel's settings page in Jellyfin's Dashboard: the Play takeover, font uploads
// and the Translate address, read from and saved to the plugin's configuration.

const PLUGIN_ID = '2c488ea7-0cae-4499-a2a7-6bae27b4e8f6';

// An address the reader may open: empty (Translate off), or https with {text} where the text goes.
export const translateUrlProblem = value => {
    if (value === '') return null;
    let url;
    try {
        url = new URL(value.replace('{text}', 'text'));
    } catch {
        return 'Enter a full https address, such as https://translate.google.com/?sl=auto&op=translate&text={text}.';
    }
    if (url.protocol !== 'https:') return 'The Translate address must start with https://.';
    if (!value.includes('{text}')) return 'Put {text} in the address where the selected text goes.';
    return null;
};

export default function (view) {
    const form = view.querySelector('.orielSettingsForm');
    const webIntegration = view.querySelector('#orielWebIntegration');
    const fontUploads = view.querySelector('#orielFontUploads');
    const translateUrl = view.querySelector('#orielTranslateUrl');
    const error = view.querySelector('.orielSettingsError');
    const saved = view.querySelector('.orielSettingsSaved');

    const say = (element, text) => {
        error.hidden = true;
        saved.hidden = true;
        if (element) {
            element.textContent = text ?? element.textContent;
            element.hidden = false;
        }
    };

    view.addEventListener('viewshow', () => {
        say(null);
        ApiClient.getPluginConfiguration(PLUGIN_ID)
            .then(configuration => {
                webIntegration.checked = configuration.EnableWebIntegration === true;
                fontUploads.checked = configuration.EnableFontUploads === true;
                translateUrl.value = configuration.TranslateUrl ?? '';
                view.dataset.loaded = 'true';
            })
            .catch(() => say(error, "Oriel's settings could not be read. Reload the page to try again."));
    });

    form.addEventListener('submit', event => {
        event.preventDefault();
        const address = translateUrl.value.trim();
        const problem = translateUrlProblem(address);
        if (problem) {
            say(error, problem);
            translateUrl.focus();
            return;
        }

        say(null);
        ApiClient.getPluginConfiguration(PLUGIN_ID)
            .then(configuration => {
                configuration.EnableWebIntegration = webIntegration.checked;
                configuration.EnableFontUploads = fontUploads.checked;
                configuration.TranslateUrl = address;
                return ApiClient.updatePluginConfiguration(PLUGIN_ID, configuration);
            })
            .then(() => say(saved, 'Saved.'))
            .catch(() => say(error, "Oriel's settings could not be saved. Try again."));
    });
}
