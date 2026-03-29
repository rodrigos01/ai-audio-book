const admin = require('firebase-admin');
const Repository = require('./repository');

class FirestoreRepository extends Repository {
  constructor() {
    super();
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    this.db = admin.firestore();
  }

  async getTitles(clientId) {
    const snapshot = await this.db.collection('titles')
      .where('client_id', '==', clientId)
      .orderBy('created_at', 'desc')
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async createTitle(title) {
    await this.db.collection('titles').doc(title.id).set({
      ...title,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    return title;
  }

  async getTitle(id, clientId) {
    const doc = await this.db.collection('titles').doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data();
    if (clientId && data.client_id !== clientId) return null;
    return { id: doc.id, ...data };
  }

  async updateTitle(id, data) {
    await this.db.collection('titles').doc(id).update(data);
  }

  async deleteTitle(id) {
    // Delete chapters and sections first (simplified for MVP: just delete title)
    await this.db.collection('titles').doc(id).delete();
  }

  async getChapters(titleId) {
    const snapshot = await this.db.collection('chapters')
      .where('title_id', '==', titleId)
      .orderBy('order_index', 'asc')
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async createChapter(chapter) {
    await this.db.collection('chapters').doc(chapter.id).set({
      ...chapter,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
    return chapter;
  }

  async getChapterWithTitle(id, clientId) {
    const doc = await this.db.collection('chapters').doc(id).get();
    if (!doc.exists) return null;
    const chapter = { id: doc.id, ...doc.data() };
    
    // Check if client owns the title
    const titleDoc = await this.db.collection('titles').doc(chapter.title_id).get();
    if (!titleDoc.exists || (clientId && titleDoc.data().client_id !== clientId)) {
        return null;
    }
    return { ...chapter, title_name: titleDoc.data().name };
  }

  async getChapter(id) {
    const doc = await this.db.collection('chapters').doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  async deleteChapter(id) {
    await this.db.collection('chapters').doc(id).delete();
  }

  async getMaxChapterOrder(titleId) {
    const snapshot = await this.db.collection('chapters')
      .where('title_id', '==', titleId)
      .orderBy('order_index', 'desc')
      .limit(1)
      .get();
    if (snapshot.empty) return 0;
    return snapshot.docs[0].data().order_index;
  }

  async getSections(chapterId, startIndex = 0) {
    const snapshot = await this.db.collection('chapter_sections')
      .where('chapter_id', '==', chapterId)
      .where('section_index', '>=', startIndex)
      .orderBy('section_index', 'asc')
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async insertSections(sections) {
    const batch = this.db.batch();
    sections.forEach(s => {
      const ref = this.db.collection('chapter_sections').doc(s.id);
      batch.set(ref, s);
    });
    await batch.commit();
  }

  async updateSection(id, data) {
    await this.db.collection('chapter_sections').doc(id).update(data);
  }
}

module.exports = FirestoreRepository;
