const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const API_KEY = import.meta.env.VITE_FIREBASE_API_KEY;

let pickerApiLoaded = false;

// Load the Google API Loader script if not already present
export const loadPickerScripts = () => {
    return new Promise((resolve) => {
        if (pickerApiLoaded) return resolve();

        // The scripts are already in index.html, we just need to wait for gapi to be ready
        const checkGapi = setInterval(() => {
            if (window.gapi && window.google) {
                clearInterval(checkGapi);
                window.gapi.load('picker', () => {
                    pickerApiLoaded = true;
                    resolve();
                });
            }
        }, 100);
    });
};

export const openGooglePicker = async (accessToken) => {
    await loadPickerScripts();

    return new Promise((resolve, reject) => {
        try {
            const picker = new window.google.picker.PickerBuilder()
                .addView(window.google.picker.ViewId.DOCUMENTS)
                .setOAuthToken(accessToken)
                .setDeveloperKey(API_KEY)
                .setOrigin(window.location.protocol + '//' + window.location.host)
                .setCallback((data) => {
                    if (data.action === window.google.picker.Action.PICKED) {
                        const doc = data.docs[0];
                        resolve({
                            id: doc.id,
                            title: doc.name,
                            url: doc.url
                        });
                    } else if (data.action === window.google.picker.Action.CANCEL) {
                        resolve(null);
                    }
                })
                .build();
            picker.setVisible(true);
        } catch (err) {
            console.error('Error creating Google Picker:', err);
            reject(err);
        }
    });
};
