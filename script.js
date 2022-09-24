let books = [];

class Book {
  constructor(title, author, readPages, totalPages, description) {
    this.title = title;
    this.author = author;
    this.readPages = readPages;
    this.totalPages = totalPages;
    this.description = description;
  }
};

function addBookToLibrary() {
  let userInputTitle = bookTitleInput.value;
  let userInputAuthor = bookAuthorInput.value;
  let userInputReadPages = readPagesInput.value;
  let userInputTotalPages = totalPagesInput.value;  
  let userInputDescription = bookDescriptionInput.value;
  
  const book = new Book (userInputTitle, userInputAuthor, userInputReadPages, userInputTotalPages, userInputDescription);
  
  if (!books.includes(book.title)){
    books.push(book);
  }

  console.log(books);
}



function displayNewBookOnPage() {
  for (let i = books.length - 1; i < books.length; i++){
    grid.innerHTML +=
    `<div class="bookCard">
    <div class= "bookImage" style="background-image: url('https://images-na.ssl-images-amazon.com/images/I/91vJKCY1okL.jpg');"></div>
    <div class= "bookOverview">
        <div class="authorAndTitle">
            <span class="bookTitle">${books[i].title}</span>
            <p class="bookAuthor">by ${books[i].author}</p>
        </div>
        <div class="bookPages">
            <span class="readPages">${books[i].readPages} </span>
            <span class="totalPages">/ ${books[i].totalPages} </span>
        </div>
        <div class="bookOptions">
            <div class="editBook">
                <span class="bookOptionIcon"><?xml version="1.0" encoding="UTF-8"?><svg id="bookEditIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36.65 36.65"><defs></defs><path class="bookOptionIcon" d="M3,33.65h2.2L27.35,11.5l-2.2-2.2L3,31.45v2.2ZM33.7,9.35l-6.4-6.4,2.1-2.1C29.97,.28,30.67,0,31.5,0c.83,0,1.53,.28,2.1,.85l2.2,2.2c.57,.57,.85,1.27,.85,2.1s-.28,1.53-.85,2.1l-2.1,2.1Zm-2.1,2.1L6.4,36.65H0v-6.4L25.2,5.05l6.4,6.4Zm-5.35-1.05l-1.1-1.1,2.2,2.2-1.1-1.1Z"/></svg></span>
                <span class="bookOptionIcon"><?xml version="1.0" encoding="UTF-8"?><svg class="bookDeleteIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 36"><defs></defs><path class="bookOptionIcon" d="M5.05,36c-.83,0-1.54-.29-2.12-.88-.58-.58-.88-1.29-.88-2.12V4.5H0V1.5H9.4V0h13.2V1.5h9.4v3h-2.05v28.5c0,.8-.3,1.5-.9,2.1s-1.3,.9-2.1,.9H5.05ZM26.95,4.5H5.05v28.5H26.95V4.5ZM10.35,28.7h3V8.75h-3V28.7Zm8.3,0h3V8.75h-3V28.7ZM5.05,4.5v0Z"/></svg></span>
            </div>
            <span class="bookStatusRead">✔</span>
        </div>
    </div>
    <div class= "seperationLine"></div>
    <div class= "bookDescription">
        <p class="descriptionHeader boldFont">Description</p>
        <p class="descriptionText">${books[i].description}</p>
    </div>
    </div>`;
  };
};





// VARIABLES TO INTERACT WITH THE WEBSITE

let addBookButton = document.getElementById("addBookButton");
let addBookOverlay = document.getElementById("addBookOverlay");
let grid = document.getElementById("booksGridContainer");

// Input Fields

let bookTitleInput = document.getElementById("bookTitleInput")
let bookAuthorInput = document.getElementById("bookAuthorInput")
let readPagesInput = document.getElementById("readPagesInput")
let totalPagesInput = document.getElementById("totalPagesInput")
let bookDescriptionInput = document.getElementById("bookDescriptionInput")
let submitBookButton = document.getElementById("submitBookButton")

const blurObjs = Array.from(
  document.getElementsByClassName('blur')
);









// BOOK FORM APPEARS AND DISAPPEARS
addBookButton.addEventListener("click", function(){
  blurBg()

  let cancelButton = document.getElementById("cancelButton");
  cancelButton.addEventListener("click", function(){
    unblurBg()
  });


  addBookOverlay.addEventListener("click", function(e){ // Overlay disappers when clicking on it, but NOT when clicking on the addButton Window
    if (e.target !== this)
    return;
    unblurBg()
  });
});


// ADDS BOOK TO LIBRARY AFTER PRESSING THE SUBMIT BUTTON
submitBookButton.addEventListener("click", function(){
  addBookToLibrary();
  unblurBg();
  displayNewBookOnPage();
});











// STYLING FUNCTIONS TO BLUR/UNBLUR BACKGROUND AND LET FORM APPEAR

function blurBg(){
  blurObjs.forEach(obj => {               //blurs the background
    obj.style.filter = "blur(3px)";
    obj.style.webkitFilter = "blur(3px)";
  });

  addBookOverlay.style.display = "flex"   //addBookContainer appears
};


function unblurBg(){
  blurObjs.forEach(obj => {
    obj.style.filter = "blur(0px)";
    obj.style.webkitFilter = "blur(0px)";
    });

    addBookOverlay.style.display = "none"     //addBookContainer disapperas
};