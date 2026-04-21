const admin = require('./firebase-config');
const Repository = require('./repository');

class FirestoreRepository extends Repository {
  constructor() {
    super();
    this.db = admin.firestore();
  }

  _getOwnerId(clientId, userId = null) {
    if (userId) return `user:${userId}`;
    return `client:${clientId}`;
  }

  async getTitles(clientId, userId = null) {
    const ownerId = this._getOwnerId(clientId, userId);
    const snapshot = await this.db.collection('titles')
      .where('owner_id', '==', ownerId)
      .get();
    
    return snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => {
        const dateA = a.created_at?.toDate ? a.created_at.toDate() : new Date(a.created_at || 0);
        const dateB = b.created_at?.toDate ? b.created_at.toDate() : new Date(b.created_at || 0);
        return dateB - dateA;
      });
  }

  async createTitle(title) {
    const ownerId = this._getOwnerId(title.client_id, title.user_id);
    const data = {
      ...title,
      owner_id: ownerId,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    };
    // Cleanup old fields if present
    delete data.user_id;
    delete data.client_id;

    await this.db.collection('titles').doc(title.id).set(data);
    return title;
  }

  async getTitle(id, clientId, userId = null) {
    const doc = await this.db.collection('titles').doc(id).get();
    if (!doc.exists) return null;
    const data = doc.data();
    
    const ownerId = this._getOwnerId(clientId, userId);
    if (data.owner_id !== ownerId) return null;
    
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

  async getChapterWithTitle(id, clientId, userId = null) {
    const doc = await this.db.collection('chapters').doc(id).get();
    if (!doc.exists) return null;
    const chapter = { id: doc.id, ...doc.data() };
    
    // Check if client/user owns the title
    const titleDoc = await this.db.collection('titles').doc(chapter.title_id).get();
    if (!titleDoc.exists) return null;
    
    const titleData = titleDoc.data();
    const ownerId = this._getOwnerId(clientId, userId);
    if (titleData.owner_id !== ownerId) return null;
    
    return { ...chapter, title_name: titleData.name };
  }

  async getChapter(id) {
    const doc = await this.db.collection('chapters').doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  async updateChapter(id, data) {
    await this.db.collection('chapters').doc(id).update(data);
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

  async linkAnonymousBooks(clientId, userId) {
    const anonOwnerId = `client:${clientId}`;
    const userOwnerId = `user:${userId}`;
    
    const snapshot = await this.db.collection('titles')
      .where('owner_id', '==', anonOwnerId)
      .get();
      
    const batch = this.db.batch();
    snapshot.docs.forEach(doc => {
      batch.update(doc.ref, { owner_id: userOwnerId });
    });
    
    await batch.commit();
    return snapshot.size;
  }
}

module.exports = FirestoreRepository;
