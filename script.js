let books = [];

class Book {
  constructor(title, author, readPages, totalPages, description, status) {
    this.title = title;
    this.author = author;
    this.readPages = readPages;
    this.totalPages = totalPages;
    this.description = description;
    this.status = status;
    this.image = imageLink;
    this.id = 0;
  }

  





  updateId = function(){
    this.id = books.indexOf(this);
  }

  getGoogleImageSearchResult = function (query, fn, param) {

    // Add API credentials
    let apikey = "AIzaSyDKj4Q32r_62_LANxSPWutJ1A5oP8M7xvc";
    let searchEngineID = "90243a17d69424fb5";

    // Building call to API
    let url = "https://www.googleapis.com/customsearch/v1?key=" + apikey + "&cx=" + searchEngineID
      + "&q=" + query + " cover" + "&searchType=" + "image" + "&num=" + "1";

    fetch(url)
    .then(result => result.json())
    .then((output) => {
        this.image = output.items[0].link;
        hideLoading();
        unblurBg();
        fn(param);
        addBookOverlay.style.display = "none"     //addBookContainer disappears
        return this.image;
    })
    .catch((err) => {
    console.error(err)
    this.image = "https://libribook.com/Images/liebe-auf-den-zweiten-kuss-pdf.jpg";
    hideLoading();
    unblurBg();
    fn(param);
    });
    
    return;
}

};






function addBookToLibrary() {
  let userInputTitle = bookTitleInput.value;
  let userInputAuthor = bookAuthorInput.value;
  let userInputReadPages = readPagesInput.value;
  let userInputTotalPages = totalPagesInput.value;  
  let userInputDescription = bookDescriptionInput.value;
  let bookStatus;
  
  if (bookTitleInput.value == "" || bookTitleInput.value == undefined){
    userInputTitle = "No Book";
  }
  if (bookAuthorInput.value == "" || bookAuthorInput.value == undefined){
    userInputAuthor = "No Author";
  }
  if (readPagesInput.value == "" || readPagesInput.value == undefined){
    userInputReadPages = "0";
  }
  if (totalPagesInput.value == "" || totalPagesInput.value == undefined || totalPagesInput.value < readPagesInput.value){
    userInputTotalPages = userInputReadPages;
  }
  if (readPagesInput.value == totalPagesInput.value){
    bookStatus = "???"
  } else if (readPagesInput.value !== totalPagesInput.value){
    bookStatus = "";
  };

  if (bookDescriptionInput.value == "" || bookDescriptionInput.value == undefined){
    userInputDescription = "No description added";
  }
  

  const book = new Book (userInputTitle, userInputAuthor, userInputReadPages, userInputTotalPages, userInputDescription, bookStatus);

  book.getGoogleImageSearchResult(userInputTitle + " by " + userInputAuthor, displayNewBookOnPage, book);
  
  if (books.indexOf(book.title) != false){
    books.push(book);
  }

  };



function displayNewBookOnPage(book) {

  // grid.innerHTML = "";

    grid.innerHTML +=
    `<div class="bookCard" data-book-index="${books.indexOf(book)}">
    <div class= "bookImage" style="background-image: url('${book.image}');"></div>
    <div class= "bookOverview">
        <div class="authorAndTitle">
            <span class="bookTitle">${book.title}</span>
            <p class="bookAuthor">by ${book.author}</p>
        </div>
        <div class="bookPages">
            <span class="readPages">${book.readPages} </span>
            <span class="totalPages">/ ${book.totalPages} </span>
        </div>
        <div class="bookOptions">
            <div class="editBook">
                <span class="bookOptionIcon"><?xml version="1.0" encoding="UTF-8"?><svg id="bookEditIcon" data-editIcon-index="${books.indexOf(book)}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36.65 36.65"><defs></defs><path class="bookOptionIcon" d="M3,33.65h2.2L27.35,11.5l-2.2-2.2L3,31.45v2.2ZM33.7,9.35l-6.4-6.4,2.1-2.1C29.97,.28,30.67,0,31.5,0c.83,0,1.53,.28,2.1,.85l2.2,2.2c.57,.57,.85,1.27,.85,2.1s-.28,1.53-.85,2.1l-2.1,2.1Zm-2.1,2.1L6.4,36.65H0v-6.4L25.2,5.05l6.4,6.4Zm-5.35-1.05l-1.1-1.1,2.2,2.2-1.1-1.1Z"/></svg></span>
                <span class="bookOptionIcon"><?xml version="1.0" encoding="UTF-8"?><svg class="bookDeleteIcon" data-deleteIcon-index="${books.indexOf(book)}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 36"><defs></defs><path class="bookOptionIcon" d="M5.05,36c-.83,0-1.54-.29-2.12-.88-.58-.58-.88-1.29-.88-2.12V4.5H0V1.5H9.4V0h13.2V1.5h9.4v3h-2.05v28.5c0,.8-.3,1.5-.9,2.1s-1.3,.9-2.1,.9H5.05ZM26.95,4.5H5.05v28.5H26.95V4.5ZM10.35,28.7h3V8.75h-3V28.7Zm8.3,0h3V8.75h-3V28.7ZM5.05,4.5v0Z"/></svg></span>
            </div>
            <span class="bookStatusRead">${book.status}</span>
        </div>
    </div>
    <div class= "seperationLine"></div>
    <div class= "bookDescription">
        <p class="descriptionHeader boldFont">Description</p>
        <p class="descriptionText">${book.description}</p>
    </div>
    </div>`;

      console.log(books);
      
      book.updateId();

      for (let i = 0; i < books.length; i++){         // Loops through every Delete-Icon and adds Event Listeners based on Index
      document.querySelector(`[data-deleteIcon-index="${i}"]`).addEventListener ("click", function () {
          document.querySelector(`[data-book-index="${i}"]`).remove();
          books.splice([books.indexOf(book)],1);
          book.updateId();
      })};
};
  



// VARIABLES TO INTERACT WITH THE WEBSITE

let addBookButton = document.getElementById("addBookButton");
let deleteBooksButton = document.getElementById("deleteBooksButton");
let addBookOverlay = document.getElementById("addBookOverlay");
let grid = document.getElementById("booksGridContainer");
let imageLink = "https://libribook.com/Images/liebe-auf-den-zweiten-kuss-pdf.jpg";

// Input Fields

let bookTitleInput = document.getElementById("bookTitleInput")
let bookAuthorInput = document.getElementById("bookAuthorInput")
let readPagesInput = document.getElementById("readPagesInput")
let totalPagesInput = document.getElementById("totalPagesInput")
let bookDescriptionInput = document.getElementById("bookDescriptionInput")
let submitBookButton = document.getElementById("submitBookButton")
let submitBooksDeletionButton = document.getElementById("submitBooksDeletion")

const blurObjs = Array.from(
  document.getElementsByClassName('blur')
);









// BOOK FORM APPEARS AND DISAPPEARS
addBookButton.addEventListener("click", function(){
  blurBg();
  addBookOverlay.style.display = "flex"   //addBookContainer appears

  addEventListenerToCancelBtns ()


  addBookOverlay.addEventListener("click", function(e){ // Overlay disappers when clicking on it, but NOT when clicking on the addButton Window
    if (e.target !== this)
    return;
    unblurBg();
    addBookOverlay.style.display = "none"     //addBookContainer disapperas
  });
});


// ADDS BOOK TO LIBRARY AFTER PRESSING THE SUBMIT BUTTON
submitBookButton.addEventListener("click", function(){
  bgLoadingScreen();
  displayLoading();

  addBookToLibrary();
});


// DELETES ALL BOOK IN THE LIBRARY
deleteBooksButton.addEventListener("click", function(){
  blurBg();
  document.getElementById("deleteAllBooksOverlay").style.display = "flex";     //addBookContainer disapperas

  addEventListenerToCancelBtns ()
});

submitBooksDeletionButton.addEventListener("click", function(){
  books = [];
  grid.innerHTML = "";
  unblurBg();
  document.getElementById("deleteAllBooksOverlay").style.display = "none"
});











// STYLING FUNCTIONS TO BLUR/UNBLUR BACKGROUND AND LET FORM APPEAR

function blurBg(){
  blurObjs.forEach(obj => {               //blurs the background
    obj.style.filter = "blur(3px)";
    obj.style.webkitFilter = "blur(3px)";
  });
};


function unblurBg(){
  blurObjs.forEach(obj => {
    obj.style.filter = "blur(0px)";
    obj.style.webkitFilter = "blur(0px)";
    });
};


function bgLoadingScreen(){
  addBookOverlay.style.display = "none"     //addBookContainer disapperas
};





















// function getGoogleImageSearchResult(query, fn, param) {

//     // Add API credentials
//     let apikey = "AIzaSyDKj4Q32r_62_LANxSPWutJ1A5oP8M7xvc";
//     let searchEngineID = "90243a17d69424fb5";

//     // Building call to API
//     let url = "https://www.googleapis.com/customsearch/v1?key=" + apikey + "&cx=" + searchEngineID
//       + "&q=" + query + " cover" + "&searchType=" + "image" + "&num=" + "1";

//     fetch(url)
//     .then(result => result.json())
//     .then((output) => {
//         imageLink = output.items[0].link;
//         hideLoading();
//         unblurBg();
//         fn(param);
//         addBookOverlay.style.display = "none"     //addBookContainer disapperas
//         return imageLink;
//     })
//     .catch((err) => {
//     console.error(err)
//     imageLink = "https://libribook.com/Images/liebe-auf-den-zweiten-kuss-pdf.jpg";
//     hideLoading();
//     unblurBg();
//     fn(param);
//     });

//     return;
// }



// Loading Animation
let displayLoading = () => {
  document.getElementById("loaderContainer").style.display = 'flex';
};

let hideLoading = () => {
  document.getElementById("loaderContainer").style.display = 'none';
};






// Add Event Listeners to all Cancel Buttons
function addEventListenerToCancelBtns (){
  let cancelButton = document.getElementsByClassName("cancelButton");
  for (var i = 0; i < cancelButton.length; i++) {
    cancelButton[i].addEventListener("click", function(){
      unblurBg();
      document.getElementById("addBookOverlay").style.display = "none"
      document.getElementById("deleteAllBooksOverlay").style.display = "none"
      document.getElementById("deleteSingleBookOverlay").style.display = "none"
  })};
}



function refreshGrid(){

  }