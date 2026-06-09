// transformBooksResponse.js
// Façade : transforme la réponse OpenLibrary brute en réponse marketplace propre.

var rawBody = context.getVariable('response.content');
var raw = JSON.parse(rawBody);

// Détermine limit/page à partir des query params (par défaut limit=10, page=1)
var limitParam = context.getVariable('request.queryparam.limit');
var pageParam = context.getVariable('request.queryparam.page');
var limit = limitParam ? parseInt(limitParam, 10) : 10;
var page = pageParam ? parseInt(pageParam, 10) : 1;

// Transforme chaque "doc" OpenLibrary en item propre
var items = (raw.docs || []).map(function(doc) {
    return {
        id: doc.key ? doc.key.replace('/works/', '') : null,
        title: doc.title || null,
        author: (doc.author_name && doc.author_name.length > 0) ? doc.author_name[0] : null,
        firstPublished: doc.first_publish_year || null,
        coverUrl: doc.cover_i ? 'https://covers.openlibrary.org/b/id/' + doc.cover_i + '-M.jpg' : null,
        rating: doc.ratings_average || null
    };
});

// Construit la nouvelle réponse façade
var facade = {
    total: raw.numFound || 0,
    page: page,
    limit: limit,
    items: items
};

// Écrase le body de la réponse avec la version transformée
context.setVariable('response.content', JSON.stringify(facade));
context.setVariable('response.header.Content-Type', 'application/json');