/**
 * Base Repository interface defining the required database operations.
 */
class Repository {
  async getTitles(clientId) { throw new Error('Not implemented'); }
  async createTitle(title) { throw new Error('Not implemented'); }
  async getTitle(id, clientId) { throw new Error('Not implemented'); }
  async updateTitle(id, data) { throw new Error('Not implemented'); }
  async deleteTitle(id) { throw new Error('Not implemented'); }
  
  async getChapters(titleId) { throw new Error('Not implemented'); }
  async createChapter(chapter) { throw new Error('Not implemented'); }
  async getChapterWithTitle(id, clientId) { throw new Error('Not implemented'); }
  async getChapter(id) { throw new Error('Not implemented'); }
  async deleteChapter(id) { throw new Error('Not implemented'); }
  async getMaxChapterOrder(titleId) { throw new Error('Not implemented'); }
  
  async getSections(chapterId, startIndex = 0) { throw new Error('Not implemented'); }
  async insertSections(sections) { throw new Error('Not implemented'); }
  async updateSection(id, data) { throw new Error('Not implemented'); }
}

module.exports = Repository;
