let myLibrary = [];

function Book() {
  // the constructor...
}

function addBookToLibrary() {
  // do stuff here
}





// VARIABLES TO INTERACT WITH THE WEBSITE

let addBookButton = document.getElementById("addBookButton");
let addBookOverlay = document.getElementById("addBookOverlay");

const blurObjs = Array.from(
  document.getElementsByClassName('blur')
);



addBookButton.addEventListener("click", function(){

  //blurs the background
  blurObjs.forEach(obj => {
    obj.style.filter = "blur(3px)";
    obj.style.webkitFilter = "blur(3px)";
  });

  //displays the addBook window
  addBookOverlay.style.display = "flex"

});