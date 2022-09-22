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







// ADD BOOK CONTAINER APPEARS
addBookButton.addEventListener("click", function(){

  //blurs the background
  blurObjs.forEach(obj => {
    obj.style.filter = "blur(3px)";
    obj.style.webkitFilter = "blur(3px)";
  });

  //displays the addBookContainer
  addBookOverlay.style.display = "flex"

});



// ADD BOOK CONTAINER DISAPPEAR FUNCTION
addBookButton.addEventListener("click", function(){

  blurObjs.forEach(obj => {               //blurs the background
    obj.style.filter = "blur(3px)";
    obj.style.webkitFilter = "blur(3px)";
  });

  addBookOverlay.style.display = "flex"   //addBookContainer appears


  let cancelButton = document.getElementById("cancelButton");
  cancelButton.addEventListener("click", function(){
    blurObjs.forEach(obj => {
    obj.style.filter = "blur(0px)";
    obj.style.webkitFilter = "blur(0px)";
    });

    addBookOverlay.style.display = "none"     //addBookContainer disapperas
  });


  addBookOverlay.addEventListener("click", function(e){ // Overlay disappers when clicking on it, but NOT when clicking on the addButton Window
    if (e.target !== this)
    return;

    blurObjs.forEach(obj => {
    obj.style.filter = "blur(0px)";
    obj.style.webkitFilter = "blur(0px)";
    });

    addBookOverlay.style.display = "none"     //addBookContainer disapperas
  });
});