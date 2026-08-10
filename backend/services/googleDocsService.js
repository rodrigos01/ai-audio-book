const { google } = require('googleapis');

function extractTextFromGoogleDoc(doc) {
  let fullText = '';
  if (!doc.body || !doc.body.content) return '';

  doc.body.content.forEach((element) => {
    if (element.paragraph) {
      element.paragraph.elements.forEach((el) => {
        if (el.textRun) {
          fullText += el.textRun.content;
        }
      });
    } else if (element.table) {
      element.table.tableRows.forEach((row) => {
        row.tableCells.forEach((cell) => {
          cell.content.forEach((cellElement) => {
            if (cellElement.paragraph) {
              cellElement.paragraph.elements.forEach((el) => {
                if (el.textRun) {
                  fullText += el.textRun.content;
                }
              });
            }
          });
          fullText += ' ';
        });
        fullText += '\n';
      });
    }
  });
  return fullText;
}

async function fetchDocumentText(documentId, googleAccessToken) {
  if (!documentId || !googleAccessToken) {
    throw new Error('documentId and googleAccessToken are required');
  }

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: googleAccessToken });

  const docs = google.docs({ version: 'v1', auth });
  const response = await docs.documents.get({ documentId });

  const content = extractTextFromGoogleDoc(response.data);
  return {
    title: response.data.title,
    content
  };
}

module.exports = {
  extractTextFromGoogleDoc,
  fetchDocumentText
};
