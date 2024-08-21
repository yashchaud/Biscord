import React from "react";
import Card from "./Testcard"; // Adjust the path according to your file structure

function App() {
  const handleButtonClick = () => {
    alert("Button clicked!");
  };

  const mapfunc = [
    {
      image: "https://via.placeholder.com/300x200",
      title: "Card Title",
      description:
        "This is a simple description of the card. It provides some context about the image and the title above.",
      buttonText: "Learn More",
      onButtonClick: handleButtonClick,
    },
    {
      image: "https://via.placeholder.com/300x200",
      title: "Card Title",
      description:
        "This is a simple description of the card. It provides some context about the image and the title above.",
      buttonText: "Learn More",
      onButtonClick: handleButtonClick,
    },
    {
      image: "https://via.placeholder.com/300x200",
      title: "Card Title",
      description:
        "This is a simple description of the card. It provides some context about the image and the title above.",
      buttonText: "Learn More",
      onButtonClick: handleButtonClick,
    },
    {
      image: "https://via.placeholder.com/300x200",
      title: "Card Title",
      description:
        "This is a simple description of the card. It provides some context about the image and the title above.",
      buttonText: "Learn More",
      onButtonClick: handleButtonClick,
    },
    {
      image: "https://via.placeholder.com/300x200",
      title: "Card Title",
      description:
        "This is a simple description of the card. It provides some context about the image and the title above.",
      buttonText: "Learn More",
      onButtonClick: handleButtonClick,
    },
    {
      image: "https://via.placeholder.com/300x200",
      title: "Card Title",
      description:
        "This is a simple description of the card. It provides some context about the image and the title above.",
      buttonText: "Learn More",
      onButtonClick: handleButtonClick,
    },
    {
      image: "https://via.placeholder.com/300x200",
      title: "Card Title",
      description:
        "This is a simple description of the card. It provides some context about the image and the title above.",
      buttonText: "Learn More",
      onButtonClick: handleButtonClick,
    },
  ];
  return (
    <div className="App bg-gray-100 w-[90vw] h-[90vh] flex justify-center items-center flex-wrap">
      {mapfunc.map((item, index) => (
        <Card
          image={item.image}
          title={item.title}
          description={item.description}
          buttonText={item.buttonText}
          onButtonClick={item.onButtonClick}
        />
      ))}
    </div>
  );
}

export default App;
